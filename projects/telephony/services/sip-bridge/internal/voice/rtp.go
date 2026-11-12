// SPDX-License-Identifier: Apache-2.0
// Taigua adaptation: extracted for the existing workspace-scoped sales system.

// 中文导读：RTP 音频包的收发、时间戳与媒体输出。
package voice

import (
	"encoding/binary"
	"log/slog"
	"math/rand/v2"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtp"

	"taigua/sip-bridge/internal/media"
)

const (
	rtpHeaderSize = 12
	// FrameDuration is the packetisation this session sends and expects. It is
	// stated in the SDP answer rather than assumed.
	FrameDuration = 20 * time.Millisecond
	// prebufferFrames is how much audio is held back before playout starts, to
	// absorb provider jitter. Three frames is 60 ms — it costs that much
	// latency once per turn and saves a stutter on every one.
	prebufferFrames = 3
	// txUnderrunGraceTicks is how many empty ticks are tolerated mid-utterance
	// before playout stops and re-buffers. A provider that stalls for one tick
	// should not cause a re-buffer on every hiccup.
	txUnderrunGraceTicks = 2
)

const dtmfDigits = "0123456789*#ABCD"

// packRTPHeader and unpackRTPPacket use pion for the wire format. Padding,
// CSRC lists and header extensions all shift where the payload starts, and a
// hand-rolled parser that ignores them feeds those bytes to the decoder as
// audio.
func packRTPHeader(dst []byte, seq uint16, timestamp, ssrc uint32, payloadType byte) []byte {
	header := rtp.Header{
		Version:        2,
		PayloadType:    payloadType & 0x7F,
		SequenceNumber: seq,
		Timestamp:      timestamp,
		SSRC:           ssrc,
	}
	dst = dst[:0]
	out, err := header.MarshalTo(dst[:rtpHeaderSize])
	if err != nil {
		// The fields above are fixed-size and cannot fail to marshal; write the
		// header by hand rather than drop the frame if that ever changes.
		dst = dst[:rtpHeaderSize]
		dst[0] = 0x80
		dst[1] = payloadType & 0x7F
		binary.BigEndian.PutUint16(dst[2:], seq)
		binary.BigEndian.PutUint32(dst[4:], timestamp)
		binary.BigEndian.PutUint32(dst[8:], ssrc)
		return dst
	}
	return dst[:out]
}

// parseDTMFEvent reads an RFC 2833 telephone-event payload.
func parseDTMFEvent(payload []byte) (digit string, isEnd bool, durationSamples int, ok bool) {
	if len(payload) < 4 {
		return "", false, 0, false
	}
	event := int(payload[0])
	if event >= len(dtmfDigits) {
		return "", false, 0, false
	}
	return string(dtmfDigits[event]), payload[1]&0x80 != 0,
		int(binary.BigEndian.Uint16(payload[2:4])), true
}

// RTPSession carries the audio of one call.
//
// Audio stays G.711-encoded on both sides of this type. The preferred provider
// path is byte passthrough, so decoding here would mean decoding and
// re-encoding every frame for no one's benefit; the paths that do need linear
// audio convert it where they need it.
type RTPSession struct {
	// LocalPort is the bound port, resolved after Start when it was zero.
	LocalPort int

	law         media.Law
	payloadType byte
	// dtmfPayloadType is negotiated from the offer; -1 disables DTMF entirely.
	dtmfPayloadType int

	rx chan []byte // inbound G.711 frames, oldest dropped when full
	tx chan []byte // outbound G.711 frames
	// Only the first speech frame of an observed turn has an entry. Frame
	// ownership is unchanged; the entry is consumed or removed on queue clear.
	txObservations sync.Map
	dtmf           chan string

	// ssrc and timestamp are read by the RTCP reporter while the send loop
	// writes them.
	ssrc      atomic.Uint32
	timestamp atomic.Uint32
	seq       uint16 // send loop only

	conn *net.UDPConn
	// allowed is the peer list the UAS accepts signalling from, applied to
	// every inbound packet; empty accepts any source. Set before Start.
	allowed    peerACL
	remoteMu   sync.Mutex
	remoteAddr *net.UDPAddr

	jitter  *jitterBuffer // receive goroutine only
	rxStats receptionStats

	running    atomic.Bool
	sent       atomic.Int64
	sentOctets atomic.Int64
	received   atomic.Int64
	// mediaStarted closes, once, when the first inbound packet arrives. It is
	// the one definition of "the caller's media path is up", shared by the
	// dead-media watch and by anything that waits to speak (MediaStarted).
	mediaStarted chan struct{}
	// firstMediaNano is when the first packet arrived, stored before
	// mediaStarted closes; zero until then.
	firstMediaNano atomic.Int64
	// lateTicks counts send ticks that arrived a whole frame late, which is
	// the visible symptom of the process being starved.
	lateTicks       atomic.Int64
	idleFrames      atomic.Int64
	background      atomic.Uint32 // 1..12 office; 17..28 opening ambience; zero off
	openingAmbience atomic.Pointer[media.OpeningAmbience]
	lastDTMFTS      int64 // receive goroutine only
	lastRTPNano     atomic.Int64

	log *slog.Logger
}

// NewRTPSession prepares a session. Nothing is bound until Start.
func NewRTPSession(localPort int, law media.Law, dtmfPayloadType int, log *slog.Logger) *RTPSession {
	if log == nil {
		log = slog.Default()
	}
	r := &RTPSession{
		LocalPort:       localPort,
		law:             law,
		payloadType:     law.PayloadType(),
		dtmfPayloadType: dtmfPayloadType,
		// Inbound is bounded and drops the oldest: stale caller audio is worse
		// than no caller audio. Outbound must hold a whole answer: a provider
		// delivers half a minute of speech in a couple of seconds, and the
		// sender cannot block on it — it is the same goroutine that has to
		// notice the caller barging in. Thirty seconds of frames; anything
		// beyond that is a runaway response and is dropped with a warning.
		rx:   make(chan []byte, 50),
		tx:   make(chan []byte, 1500),
		dtmf: make(chan string, 50),

		mediaStarted: make(chan struct{}),
		jitter:       newJitterBuffer(law),
		// A sequence number from the lower half of the space keeps an early
		// loss from having to reason about wrap-around.
		seq:        uint16(rand.Uint32()) & 0x7FFF,
		lastDTMFTS: -1,
		log:        log,
	}
	r.ssrc.Store(rand.Uint32())
	r.timestamp.Store(rand.Uint32())
	return r
}

// Frames yields inbound audio, one 20 ms G.711 frame per receive.
//
// Each frame comes from the media pool and stays valid until the receiver
// hands it back with media.PutBytes.
func (r *RTPSession) Frames() <-chan []byte { return r.rx }

// DTMF yields digits from RFC 2833 events and SIP INFO alike.
func (r *RTPSession) DTMF() <-chan string { return r.dtmf }

// Law reports the negotiated companding law.
func (r *RTPSession) Law() media.Law { return r.law }

// Start binds the local port and begins receiving.
func (r *RTPSession) Start(remote *net.UDPAddr) error {
	r.remoteMu.Lock()
	if r.remoteAddr != nil && remote.String() != r.remoteAddr.String() {
		// A new transport address makes this a new source (RFC 3550 §5.1).
		r.ssrc.Store(rand.Uint32())
	}
	r.remoteAddr = remote
	r.remoteMu.Unlock()

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: r.LocalPort})
	if err != nil {
		return err
	}
	r.conn = conn
	r.LocalPort = conn.LocalAddr().(*net.UDPAddr).Port
	r.running.Store(true)
	r.lastRTPNano.Store(time.Now().UnixNano())

	go r.readLoop()
	r.log.Info("rtp started", "port", r.LocalPort, "remote", remote.String(),
		"codec", r.law.String(), "payloadType", r.payloadType)
	return nil
}

// SetRemote redirects outbound audio, for re-negotiation.
func (r *RTPSession) SetRemote(remote *net.UDPAddr) {
	r.remoteMu.Lock()
	r.remoteAddr = remote
	r.remoteMu.Unlock()
}

// HasReceived reports whether any audio packet has arrived on this session.
// LastPacketAt cannot answer that: Start seeds it with the start time.
func (r *RTPSession) HasReceived() bool {
	select {
	case <-r.mediaStarted:
		return true
	default:
		return false
	}
}

// FirstMediaAt is when the first inbound packet arrived, zero before it.
func (r *RTPSession) FirstMediaAt() time.Time {
	n := r.firstMediaNano.Load()
	if n == 0 {
		return time.Time{}
	}
	return time.Unix(0, n)
}

// MediaStarted closes when the first inbound packet arrives (a DTMF event
// packet counts: it proves the path carries media). It closes exactly once and
// stays closed. HasReceived is this channel read without blocking.
func (r *RTPSession) MediaStarted() <-chan struct{} { return r.mediaStarted }

// LastPacketAt reports when audio last arrived, which is how a dead media path
// is detected on a dialog that is still nominally up. Before the first packet
// it is the time Start ran; ask HasReceived whether anything has come at all.
func (r *RTPSession) LastPacketAt() time.Time {
	return time.Unix(0, r.lastRTPNano.Load())
}

// Send queues one 20 ms G.711 frame. The frame is copied, so the caller keeps
// ownership of its buffer. It reports whether the frame was accepted; a full
// queue means the provider is producing faster than real time.
func (r *RTPSession) Send(frame []byte) bool {
	return r.sendFrame(frame, nil)
}

type rtpSendObservation struct {
	queuedAt time.Time
	log      *slog.Logger
}

// SendObserved measures queue-to-first-UDP-send without changing buffering,
// pacing or the frame payload. It does not claim handset playback time.
func (r *RTPSession) SendObserved(frame []byte, log *slog.Logger) bool {
	return r.sendFrame(frame, &rtpSendObservation{queuedAt: time.Now(), log: log})
}

func (r *RTPSession) sendFrame(frame []byte, observation *rtpSendObservation) bool {
	buf := media.GetBytes(len(frame))
	buf = append(buf, frame...)
	if observation != nil && len(buf) > 0 {
		r.txObservations.Store(&buf[0], observation)
	}
	select {
	case r.tx <- buf:
		return true
	default:
		if len(buf) > 0 {
			r.txObservations.Delete(&buf[0])
		}
		media.PutBytes(buf)
		return false
	}
}

// Pending is how many frames are queued but not yet sent. Generating audio and
// the caller hearing it are separated by however much is in this queue, which
// is what anything sequenced after speech has to wait on.
func (r *RTPSession) Pending() int { return len(r.tx) }

// The scene is configured independently from the cloned speaker. Mixing is
// outbound only and happens at playout time, after interruption has flushed
// queued speech. It never enters recognition or the recording resume cursor.
func (r *RTPSession) SetBackgroundScene(scene string, volume int) {
	if scene == "opening" {
		if volume <= 0 {
			r.background.Store(0)
		} else {
			r.background.Store(uint32(16 + min(12, volume)))
		}
		return
	}
	if scene != "office" {
		r.background.Store(0)
		return
	}
	if volume == 0 {
		volume = 6
	}
	r.background.Store(uint32(max(1, min(12, volume))))
}

// SetOpeningAmbience receives validated opening audio, keeps only aggregate
// noise statistics and never adds output ambience to microphone recognition.
func (r *RTPSession) SetOpeningAmbience(pcm []byte) {
	r.openingAmbience.Store(media.AnalyzeOpeningAmbience(pcm))
}

// ClearTx drops queued audio, which is what barge-in needs. The two frames
// already in flight mean silence reaches the caller within about 40 ms.
func (r *RTPSession) ClearTx() int {
	cleared := 0
	for {
		select {
		case frame := <-r.tx:
			if len(frame) > 0 {
				r.txObservations.Delete(&frame[0])
			}
			media.PutBytes(frame)
			cleared++
		default:
			return cleared
		}
	}
}

// PushDTMF merges a digit from SIP INFO into the same stream as RFC 2833, so
// callers never have to care which way it arrived.
func (r *RTPSession) PushDTMF(digit string) {
	select {
	case r.dtmf <- digit:
	default:
	}
}

func (r *RTPSession) Stop() {
	if !r.running.CompareAndSwap(true, false) {
		return
	}
	if r.conn != nil {
		_ = r.conn.Close()
	}
	r.ClearTx()
}

func (r *RTPSession) readLoop() {
	buf := make([]byte, 2048)
	for r.running.Load() {
		n, from, err := r.conn.ReadFromUDPAddrPort(buf)
		if err != nil {
			return // the connection was closed
		}
		// A port in the range is reachable by anyone who can guess it; audio
		// from outside the peer list would otherwise be heard as the caller.
		if !r.allowed.allows(from.Addr()) {
			continue
		}
		r.handlePacket(buf[:n])
	}
	r.jitter.reset()
}

func (r *RTPSession) handlePacket(data []byte) {
	if len(data) < rtpHeaderSize {
		return
	}
	var pkt rtp.Packet
	if err := pkt.Unmarshal(data); err != nil {
		return
	}
	if len(pkt.Payload) == 0 {
		return
	}
	// The timestamp is stored before the count moves and the channel closes,
	// so a watcher that sees HasReceived true never reads the Start seed from
	// LastPacketAt. Add returns 1 for exactly one packet, which is what makes
	// the close happen once however many packets follow.
	r.lastRTPNano.Store(time.Now().UnixNano())
	if r.received.Add(1) == 1 {
		r.firstMediaNano.Store(time.Now().UnixNano())
		close(r.mediaStarted)
	}

	if r.dtmfPayloadType >= 0 && int(pkt.PayloadType) == r.dtmfPayloadType {
		// Every packet of an event repeats until the end bit, and the end
		// packet itself is sent three times; the timestamp identifies the
		// event, so one digit is emitted per event rather than per packet.
		digit, isEnd, _, ok := parseDTMFEvent(pkt.Payload)
		if ok && isEnd && int64(pkt.Timestamp) != r.lastDTMFTS {
			r.lastDTMFTS = int64(pkt.Timestamp)
			r.PushDTMF(digit)
		}
		return
	}

	// A payload type that was never negotiated is not audio in the codec this
	// session decodes, so it is ignored rather than guessed at.
	if pkt.PayloadType != r.payloadType {
		return
	}
	if pkt.SSRC == r.ssrc.Load() {
		r.ssrc.Store(rand.Uint32()) // collision with our own source
	}
	r.rxStats.onPacket(pkt.SequenceNumber, pkt.Timestamp, pkt.SSRC)

	payload := media.GetBytes(len(pkt.Payload))
	payload = append(payload, pkt.Payload...)
	for _, frame := range r.jitter.push(pkt.SequenceNumber, payload) {
		r.deliver(frame)
	}
}

// deliver hands a frame to the consumer, discarding the oldest when it has
// fallen behind: for a live conversation, catching up matters more than
// completeness.
func (r *RTPSession) deliver(frame []byte) {
	select {
	case r.rx <- frame:
		return
	default:
	}
	select {
	case stale := <-r.rx:
		media.PutBytes(stale)
	default:
	}
	select {
	case r.rx <- frame:
	default:
		media.PutBytes(frame)
	}
}

// Run paces outbound audio and returns when the session stops.
//
// A ticker drives it rather than a sleep of one frame duration: sleeping does
// not account for the time spent building each packet, so the error
// accumulates and the far end eventually hears the drift. When the process is
// starved badly enough to miss ticks entirely, the loop re-bases instead of
// sending a burst to catch up — a burst would arrive as a jitter spike.
func (r *RTPSession) Run() {
	ticker := time.NewTicker(FrameDuration)
	defer ticker.Stop()

	packet := make([]byte, 0, rtpHeaderSize+media.FrameSamples)
	silence := media.SilenceFrame(r.law)
	scene := media.NewOfficeScene(rand.Uint64())
	ambience := media.NewOpeningAmbienceMixer(rand.Uint64())
	format := media.G711Format(r.law)

	playing := false
	underruns := 0
	var prebufferDeadline time.Time
	expected := time.Now()

	for r.running.Load() {
		<-ticker.C
		expected = expected.Add(FrameDuration)
		if lag := time.Since(expected); lag > FrameDuration {
			r.lateTicks.Add(1)
			expected = time.Now()
		}

		var frame []byte
		var pooled bool
		queued := len(r.tx)
		switch {
		case playing || queued >= prebufferFrames ||
			(queued > 0 && !prebufferDeadline.IsZero() && !time.Now().Before(prebufferDeadline)):
			// ClearTx may drain the queue after len(tx) was observed. A blocking
			// receive here would stop RTP forever on an otherwise healthy call.
			select {
			case frame = <-r.tx:
				pooled, playing = true, true
				underruns = 0
			default:
				// A brief gap in supply is padded rather than treated as the
				// end of the utterance.
				frame = silence
				if playing {
					underruns++
					if underruns > txUnderrunGraceTicks {
						playing, underruns = false, 0
					}
				}
			}
		default:
			// Short utterances never reach the prebuffer target, so the wait
			// for it is bounded.
			if queued == 0 {
				prebufferDeadline = time.Now().Add(prebufferFrames * FrameDuration)
			}
			frame = silence
		}
		if !pooled {
			r.idleFrames.Add(1)
		}
		var observation *rtpSendObservation
		if pooled && len(frame) > 0 {
			if value, ok := r.txObservations.LoadAndDelete(&frame[0]); ok {
				observation = value.(*rtpSendObservation)
			}
		}
		if len(frame) > media.FrameSamples {
			frame = frame[:media.FrameSamples]
		}

		packet = packRTPHeader(packet, r.seq, r.timestamp.Load(), r.ssrc.Load(), r.payloadType)
		packet = append(packet, frame...)
		if volume := r.background.Load(); volume > 0 {
			if volume > 16 {
				ambience.Mix(packet[rtpHeaderSize:], format, r.openingAmbience.Load(), int(volume)-16)
			} else {
				scene.Mix(packet[rtpHeaderSize:], format, int(volume), pooled)
			}
		}
		if pooled {
			media.PutBytes(frame)
		}

		r.remoteMu.Lock()
		remote := r.remoteAddr
		r.remoteMu.Unlock()
		if r.conn != nil && remote != nil {
			if _, err := r.conn.WriteToUDP(packet, remote); err != nil {
				if observation != nil {
					observation.log.Info("voice phase", "phase", "first_rtp_send_failed", "stageAt", time.Now().UTC())
				}
				return
			}
			if observation != nil {
				observation.log.Info("voice phase", "phase", "first_rtp_sent", "stageAt", time.Now().UTC(),
					"queueToRtpSendMs", time.Since(observation.queuedAt).Milliseconds(), "prebufferFrames", prebufferFrames, "frameDurationMs", FrameDuration.Milliseconds())
			}
		} else if observation != nil {
			observation.log.Info("voice phase", "phase", "first_rtp_send_unavailable", "stageAt", time.Now().UTC())
		}

		r.seq++
		r.timestamp.Add(media.FrameSamples)
		r.sent.Add(1)
		r.sentOctets.Add(media.FrameSamples) // G.711 is one byte per sample
	}
}

// Health reports frames sent, of which silence, and ticks that ran late.
func (r *RTPSession) Health() (sent, idle, late int64) {
	return r.sent.Load(), r.idleFrames.Load(), r.lateTicks.Load()
}

// JitterStats reports frames lost, dropped as too late, and silence-filled.
func (r *RTPSession) JitterStats() (lost, dropped, filled int64) {
	return r.jitter.stats()
}

// RTPMetrics describes only the local FreeSWITCH-to-bridge media leg.
// Sampling uses atomics and the existing estimator lock; it never sends RTP,
// RTCP or switch commands. Missing media has no known jitter or packet age.
type RTPMetrics struct {
	ReceivedPackets int64    `json:"receivedPackets"`
	SentPackets     int64    `json:"sentPackets"`
	LostFrames      int64    `json:"lostFrames"`
	DroppedFrames   int64    `json:"droppedFrames"`
	FilledFrames    int64    `json:"filledFrames"`
	LateSendTicks   int64    `json:"lateSendTicks"`
	JitterMs        *float64 `json:"jitterMs"`
	LastPacketAgeMs *int64   `json:"lastPacketAgeMs"`
}

func (r *RTPSession) Metrics() RTPMetrics {
	lost, dropped, filled := r.JitterStats()
	m := RTPMetrics{ReceivedPackets: r.received.Load(), SentPackets: r.sent.Load(), LostFrames: lost, DroppedFrames: dropped, FilledFrames: filled, LateSendTicks: r.lateTicks.Load(), JitterMs: r.rxStats.jitterMilliseconds()}
	if r.HasReceived() {
		age := max(int64(0), time.Since(r.LastPacketAt()).Milliseconds())
		m.LastPacketAgeMs = &age
	}
	return m
}
