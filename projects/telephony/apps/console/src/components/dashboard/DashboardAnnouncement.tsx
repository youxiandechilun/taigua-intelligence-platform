/*
 * 中文导读：数据看板的 DashboardAnnouncement 组件，封装该界面的展示与交互。
 */
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAnnouncementFeed, type AnnouncementStyle } from "@/src/lib/api/resources/announcements";
import styles from "./DashboardAnnouncement.module.css";

const pixelsPerSecond = { slow: 45, normal: 70, fast: 105 };

export function AnnouncementMarquee({ announcement, onCycle }: { announcement: AnnouncementStyle; onCycle?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, text: 0 });
  useEffect(() => {
    const frame = viewport.current, text = message.current;
    if (!frame || !text) return;
    const measure = () => setDimensions({ width: frame.clientWidth, text: text.scrollWidth });
    const observer = new ResizeObserver(measure);
    observer.observe(frame); observer.observe(text); measure();
    return () => observer.disconnect();
  }, []);
  const color = /^#[0-9a-fA-F]{6}$/.test(announcement.color) ? announcement.color : "#b83240";
  const style = {
    "--announcement-color": color,
    "--announcement-width": `${dimensions.width}px`,
    "--announcement-duration": `${Math.max(4, (dimensions.width + dimensions.text) / pixelsPerSecond[announcement.speed])}s`,
    fontSize: `${Math.min(24, Math.max(12, announcement.fontSize))}px`,
  } as CSSProperties;
  return <div className={styles.shell} style={style} role="status" aria-label="公司公告" title={announcement.text}>
    <span className="sr-only">{announcement.text}</span>
    <div ref={viewport} className={styles.viewport} aria-hidden="true">
      <div ref={message} className={styles.track} style={{ visibility: dimensions.width ? "visible" : "hidden" }} onAnimationIteration={onCycle}>
        {announcement.text}
      </div>
    </div>
  </div>;
}

export function DashboardAnnouncement() {
  const query = useAnnouncementFeed();
  const [cursor, setCursor] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const feed = query.data;
  useEffect(() => {
    const update = () => setClock(Date.now());
    document.addEventListener("visibilitychange", update);
    if (!feed?.nextChangeAt) return () => document.removeEventListener("visibilitychange", update);
    const delay = Date.parse(feed.nextChangeAt) - Date.parse(feed.serverNow);
    const timer = window.setTimeout(update, Math.min(2147483647, Math.max(0, delay)));
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [feed?.nextChangeAt, feed?.serverNow]);
  useEffect(() => {
    if ((feed?.announcements.length ?? 0) < 2) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const update = () => {
      if (timer) window.clearInterval(timer);
      if (preference.matches) timer = window.setInterval(() => setCursor(value => value + 1), 10000);
    };
    update(); preference.addEventListener("change", update);
    return () => { if (timer) window.clearInterval(timer); preference.removeEventListener("change", update); };
  }, [feed?.announcements.length]);
  if (!feed) return null;
  const now = Date.parse(feed.serverNow) + Math.max(0, clock - query.dataUpdatedAt);
  const rows = feed.announcements.filter(row => !row.endsAt || Date.parse(row.endsAt) > now);
  const current = rows[cursor % rows.length];
  if (!current) return null;
  return <AnnouncementMarquee key={`${current.id}-${current.updatedAt}`} announcement={current} onCycle={() => setCursor(value => value + 1)} />;
}
