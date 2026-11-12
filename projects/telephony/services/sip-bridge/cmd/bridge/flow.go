// 中文导读：共享基础能力：flow.go。供 SIP 语音桥中的相关模块调用。
package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type flowNode struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Text    string `json:"text"`
	Field   string `json:"field"`
	Outcome string `json:"outcome"`
}
type flowEdge struct {
	Source    string `json:"source"`
	Target    string `json:"target"`
	Branch    string `json:"branch"`
	Condition string `json:"condition"`
}
type flowGraph struct {
	Revision string     `json:"revision"`
	Entry    string     `json:"entry"`
	Nodes    []flowNode `json:"nodes"`
	Edges    []flowEdge `json:"edges"`
}
type flowRuntime struct {
	graph     *flowGraph
	node      string
	steps     int
	lastField string
}

// 中文注释：验证流程规模与入口节点，建立当前通话独立的流程状态。
func newFlowRuntime(g *flowGraph) *flowRuntime {
	if g == nil || len(g.Nodes) == 0 || len(g.Nodes) > 80 || len(g.Edges) > 240 {
		return nil
	}
	f := &flowRuntime{graph: g, node: g.Entry}
	if f.current() == nil {
		return nil
	}
	return f
}
func (f *flowRuntime) current() *flowNode {
	for i := range f.graph.Nodes {
		if f.graph.Nodes[i].ID == f.node {
			return &f.graph.Nodes[i]
		}
	}
	return nil
}
// 中文注释：把当前位置和可选分支转成模型提示；提示内容来自当前流程状态。
func (f *flowRuntime) instructions() string {
	branches := []map[string]string{}
	for _, e := range f.graph.Edges {
		if e.Source == f.node {
			branches = append(branches, map[string]string{"branch": e.Branch, "condition": e.Condition})
		}
	}
	state, _ := json.Marshal(map[string]any{"node": f.current(), "branches": branches})
	return "\n【流程执行工具与实时位置】\n" + string(state) + "\n开场节点是沟通计划，不代表客户已经完整听到开场；以实时播放状态为准。客户只说喂、你好、嗯，或只问哪位、哪里、哪家公司、有什么事时，先回答当前问题并简短接续尚未听到的必要介绍，不视为同意继续或业务意向，也不推进节点。不得整段重播。仅在客户的完整意思确实满足当前节点某个分支条件时调用 advance_flow；采集值必须是客户明确提供的对应信息，value 不能填写猜测、反问或语气词。拒绝、未知、跳过或结束可以走已配置的相应分支并保留空值，不能要求客户补齐信息才能退出。客户反问、换话题、纠正或说半句时可以暂停当前流程并自然回应，不必为了每句话都推进而强配分支。没有匹配分支时保持当前节点，只针对缺失意思澄清一次；不能重播节点话术或循环调用同一个失败分支。已经明确给出的信息记住，不重问。收到工具成功结果后自然衔接新节点；错误不意味着重新读当前节点。拒绝沟通、要求人工或不再联系的优先结束规则不受流程限制。"
}
// 中文注释：按已配置分支前进，检查步数与跳转循环，未匹配时保持当前位置。
func (f *flowRuntime) advance(branch, value string) (string, string, *flowNode) {
	if f.steps >= 120 {
		return `{"error":"step_limit"}`, "请礼貌告别并调用 end_call。", nil
	}
	old := f.current()
	if old == nil {
		return `{"error":"missing_node"}`, "请结束本通话。", nil
	}
	var next *flowNode
	for _, e := range f.graph.Edges {
		if e.Source == f.node && e.Branch == branch {
			for i := range f.graph.Nodes {
				if f.graph.Nodes[i].ID == e.Target {
					next = &f.graph.Nodes[i]
					break
				}
			}
			break
		}
	}
	if next == nil {
		return `{"saved":false,"error":"branch_not_configured"}`, "当前节点没有这个分支。保持当前位置，先根据上下文回应客户当前问题或纠正；仅在确实不明白时针对缺失部分澄清一次。不得原句重播节点、重复提交同一失败分支或擅自跳转。", nil
	}
	visited := map[string]bool{}
	for next.Kind == "jump" {
		if visited[next.ID] {
			return `{"error":"jump_cycle"}`, "请结束本通话。", nil
		}
		visited[next.ID] = true
		var target *flowNode
		for _, e := range f.graph.Edges {
			if e.Source == next.ID && e.Branch == "全部" {
				for i := range f.graph.Nodes {
					if f.graph.Nodes[i].ID == e.Target {
						target = &f.graph.Nodes[i]
					}
				}
			}
		}
		if target == nil {
			return `{"error":"missing_jump"}`, "请结束本通话。", nil
		}
		next = target
	}
	// An explicit refusal/unknown branch or an ending is a valid exit even
	// without a collected value. It must not trap the customer in a question.
	collectsValue := old.Kind == "collect"
	switch branch {
	case "否定", "拒绝", "未识别", "中性", "未知", "不知道", "不清楚", "不愿回答", "跳过":
		collectsValue = false
	}
	if next.Kind == "end" || next.Kind == "handoff" {
		collectsValue = false
	}
	if collectsValue && strings.TrimSpace(value) == "" {
		return `{"saved":false,"error":"missing_explicit_value"}`, "该采集字段仍未明确，保持当前节点。客户若在反问先回答，若在补充先听完；不要把反问或语气词当成字段值，也不要重复整句业务提问。拒绝、未知或结束可走已配置的对应分支，不要求补齐字段。", nil
	}
	f.lastField = ""
	if old.Kind == "collect" && strings.TrimSpace(value) != "" {
		f.lastField = old.Field
	}
	f.node = next.ID
	f.steps++
	result, _ := json.Marshal(map[string]any{"saved": true, "currentNode": next.ID, "title": next.Title, "text": next.Text, "kind": next.Kind})
	hint := fmt.Sprintf("已到达节点「%s」。按下列内容自然说一两句并等待客户：%s。不要重说开场白。", next.Title, next.Text)
	if next.Kind == "end" || next.Kind == "handoff" {
		hint = "只说以下结束语，随后系统会结束电话：" + next.Text
		if next.Kind == "handoff" {
			hint += "。已登记人工跟进意向，不能说已实时转接。"
		}
	}
	return string(result), hint, next
}
func (a *app) recordFlow(c *call, n *flowNode, branch string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.FlowTrace) < 160 {
		c.FlowTrace = append(c.FlowTrace, flowTrace{n.ID, n.Title, branch, time.Now().UTC().Format(time.RFC3339Nano)})
	}
	if n.Outcome != "" {
		c.FlowOutcome = n.Outcome
	}
	if n.Kind == "handoff" {
		c.Handoff = true
	}
}
