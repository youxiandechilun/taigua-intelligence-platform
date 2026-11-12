/*
 * 中文导读：共享基础能力：route-edges.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Geometry for the script canvas. Routes are calculated off the main thread and
// rendered as sampled cubic splines so cards never get hidden behind a long
// rectangular detour.
export type Point = { x: number; y: number };
export type PortSide = "top" | "right" | "bottom" | "left";
export type RouteRect = { id: string; x: number; y: number; width: number; height: number };
export type RouteEdge = {
  id: string;
  source: string;
  target: string;
  from: Point;
  to: Point;
  fromSide: PortSide;
  toSide: PortSide;
  label: string;
};
export type RouteInput = { nodes: RouteRect[]; edges: RouteEdge[] };
export type EdgeRoute = { points: Point[]; path?: string; label: Point | null; clear: boolean };

type Box = { id: string; left: number; right: number; top: number; bottom: number };
type Fan = { source: number; target: number; rank: number };
type Drawing = { path: string; points: Point[] };
type Candidate = Drawing & { score: number; congestion: number };

const EPS = 0.1;
// Keep the side lanes wide enough to read at the default canvas zoom.  The
// previous 34px lane made every vertical connection look like a straight
// wire until the user zoomed in.
const LANE = 72;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const number = (value: number) => Math.round(value * 10) / 10;
const coords = (p: Point) => number(p.x) + " " + number(p.y);
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Point, factor: number): Point => ({ x: a.x * factor, y: a.y * factor });
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const expand = (node: RouteRect, gap: number): Box => ({
  id: node.id,
  left: node.x - gap,
  right: node.x + node.width + gap,
  top: node.y - gap,
  bottom: node.y + node.height + gap,
});

function sideVector(side: PortSide): Point {
  if (side === "top") return { x: 0, y: -1 };
  if (side === "right") return { x: 1, y: 0 };
  if (side === "bottom") return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function inside(point: Point, box: Box) {
  return (
    point.x > box.left + EPS &&
    point.x < box.right - EPS &&
    point.y > box.top + EPS &&
    point.y < box.bottom - EPS
  );
}

// Segment clipping is used against sampled cubic points. This catches a curve
// that briefly passes through a card even when both control points are outside.
function crosses(a: Point, b: Point, box: Box) {
  let low = 0;
  let high = 1;
  for (const [value, delta, min, max] of [
    [a.x, b.x - a.x, box.left + EPS, box.right - EPS],
    [a.y, b.y - a.y, box.top + EPS, box.bottom - EPS],
  ]) {
    if (Math.abs(delta) < EPS) {
      if (value <= min || value >= max) return false;
      continue;
    }
    const first = (min - value) / delta;
    const second = (max - value) / delta;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
    if (low >= high) return false;
  }
  return high > 0 && low < 1;
}

function pathClear(points: Point[], boxes: Box[]) {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!;
    const to = points[index]!;
    if (boxes.some((box) => crosses(from, to, box))) return false;
  }
  return true;
}

class Pen {
  path: string;
  points: Point[];

  constructor(start: Point) {
    this.path = "M " + coords(start);
    this.points = [start];
  }

  line(end: Point) {
    const start=this.points[this.points.length-1]!;
    const count=Math.max(1,Math.ceil(distance(start,end)/8));
    this.path+=' L '+coords(end);
    for(let index=1;index<=count;index++)this.points.push(mix(start,end,index/count));
  }

  curve(control1: Point, control2: Point, end: Point) {
    const start = this.points[this.points.length - 1]!;
    this.path += " C " + coords(control1) + " " + coords(control2) + " " + coords(end);
    const segments = Math.max(
      12,
      Math.ceil((distance(start, control1) + distance(control1, control2) + distance(control2, end)) / 8),
    );
    for (let index = 1; index <= segments; index++) {
      const t = index / segments;
      const inverse = 1 - t;
      this.points.push({
        x:
          inverse * inverse * inverse * start.x +
          3 * inverse * inverse * t * control1.x +
          3 * inverse * t * t * control2.x +
          t * t * t * end.x,
        y:
          inverse * inverse * inverse * start.y +
          3 * inverse * inverse * t * control1.y +
          3 * inverse * t * t * control2.y +
          t * t * t * end.y,
      });
    }
  }
}

// A single cubic cannot always go around several cards. Search the open
// corridors between their boundaries, then soften the corners of that route.
function corridor(from:Point,to:Point,boxes:Box[]):Point[]|null{
 if(boxes.some(box=>inside(from,box)||inside(to,box)))return null;
 const xs=[...new Set([from.x,to.x,...boxes.flatMap(box=>[box.left-1,box.right+1])])].sort((a,b)=>a-b);
 const ys=[...new Set([from.y,to.y,...boxes.flatMap(box=>[box.top-1,box.bottom+1])])].sort((a,b)=>a-b);
 const width=xs.length,count=width*ys.length;
 const start=ys.indexOf(from.y)*width+xs.indexOf(from.x),end=ys.indexOf(to.y)*width+xs.indexOf(to.x);
 const best=new Float64Array(count*3).fill(Infinity),previous=new Int32Array(count*3).fill(-1),closed=new Uint8Array(count*3);
 const heap:Array<{state:number;score:number}>=[];
 function push(state:number,score:number){
  const item={state,score};let index=heap.length;heap.push(item);
  while(index){const parent=(index-1)>>1;if(heap[parent]!.score<=score)break;heap[index]=heap[parent]!;index=parent;}heap[index]=item;
 }
 function pop(){
  const first=heap[0]!,last=heap.pop()!;
  if(heap.length){let index=0;while(index*2+1<heap.length){let child=index*2+1;if(child+1<heap.length&&heap[child+1]!.score<heap[child]!.score)child++;if(heap[child]!.score>=last.score)break;heap[index]=heap[child]!;index=child;}heap[index]=last;}
  return first.state;
 }
 const point=(id:number):Point=>({x:xs[id%width]!,y:ys[Math.floor(id/width)]!});
 const clear=new Map<number,boolean>();
 function open(a:number,b:number){
  const key=Math.min(a,b)*count+Math.max(a,b),cached=clear.get(key);if(cached!==undefined)return cached;
  const first=point(a),last=point(b),value=!boxes.some(box=>crosses(first,last,box));clear.set(key,value);return value;
 }
 const initial=start*3+2;best[initial]=0;push(initial,Math.abs(from.x-to.x)+Math.abs(from.y-to.y));
 while(heap.length){
  const state=pop();if(closed[state])continue;closed[state]=1;
  const id=Math.floor(state/3),direction=state%3;
  if(id===end){const result:Point[]=[];for(let current=state;current!==-1;current=previous[current]!)result.push(point(Math.floor(current/3)));return result.reverse();}
  const x=id%width,y=Math.floor(id/width),neighbours:Array<[number,number]>=[];
  if(x>0)neighbours.push([id-1,0]);if(x+1<width)neighbours.push([id+1,0]);if(y>0)neighbours.push([id-width,1]);if(y+1<ys.length)neighbours.push([id+width,1]);
  for(const [next,nextDirection]of neighbours){
   if(!open(id,next))continue;
   const nextState=next*3+nextDirection,position=point(next),cost=best[state]!+distance(point(id),position)+(direction!==2&&direction!==nextDirection?20:0);
   if(cost>=best[nextState]!)continue;best[nextState]=cost;previous[nextState]=state;
   push(nextState,cost+Math.abs(position.x-to.x)+Math.abs(position.y-to.y));
  }
 }
 return null;
}

function soften(points:Point[],radius:number):Drawing{
 const simple:Point[]=[];
 for(const point of points){
  if(simple.length&&distance(simple.at(-1)!,point)<EPS)continue;
  while(simple.length>1){const a=simple.at(-2)!,b=simple.at(-1)!,ab={x:b.x-a.x,y:b.y-a.y},bc={x:point.x-b.x,y:point.y-b.y};if(Math.abs(ab.x*bc.y-ab.y*bc.x)>EPS||ab.x*bc.x+ab.y*bc.y<=0)break;simple.pop();}
  simple.push(point);
 }
 const pen=new Pen(simple[0]!);
 for(let index=1;index<simple.length-1;index++){
  const before=simple[index-1]!,corner=simple[index]!,after=simple[index+1]!,r=Math.min(radius,distance(before,corner)/2,distance(corner,after)/2);
  const enter=mix(corner,before,r/distance(before,corner)),exit=mix(corner,after,r/distance(corner,after));
  pen.line(enter);pen.curve(mix(enter,corner,2/3),mix(exit,corner,2/3),exit);
 }
 pen.line(simple.at(-1)!);return pen;
}

function detour(edge:RouteEdge,nodes:RouteRect[],fan:Fan):Drawing|null{
 const fromVector=sideVector(edge.fromSide),toVector=sideVector(edge.toSide);
 const visible=nodes.map(node=>expand(node,node.id===edge.source||node.id===edge.target?0:6));
 for(const gap of [16+Math.min(36,fan.rank*6),8,0]){
  const boxes=nodes.map(node=>expand(node,gap));
  const lead=(origin:Point,direction:Point,own:string)=>[gap+32,gap+16,16,10,4].map(amount=>add(origin,scale(direction,amount))).find(point=>!boxes.some(box=>inside(point,box))&&pathClear([origin,point],boxes.filter(box=>box.id!==own)));
  const from=lead(edge.from,fromVector,edge.source),to=lead(edge.to,toVector,edge.target);if(!from||!to)continue;
  const middle=corridor(from,to,boxes);if(!middle)continue;
  const points=[edge.from,...middle,edge.to];
  for(const radius of [32,16,6,0]){const drawing=soften(points,radius);if(pathClear(drawing.points,visible))return drawing;}
 }
 return null;
}

// Curves are kept bounded by the source/target box. This prevents a backwards
// branch from turning a short connection into a huge U-shaped loop.
function spline(edge: RouteEdge, fan: Fan, lane: number): Drawing {
  const fromDirection = sideVector(edge.fromSide);
  const toDirection = sideVector(edge.toSide);
  const dx = edge.to.x - edge.from.x;
  const dy = edge.to.y - edge.from.y;
  const axis = Math.max(Math.abs(dx), Math.abs(dy));
  const lead = Math.max(58, Math.min(170, axis * 0.28));
  const sourceLead = lead + Math.min(28, Math.abs(fan.source) * 0.2);
  const targetLead = lead + Math.min(28, Math.abs(fan.target) * 0.2);
  const vertical = Math.abs(dy) >= Math.abs(dx);
  // A centred connection still gets a small bow.  This keeps the main spine
  // calm while making the cubic route visible at normal zoom; side lanes keep
  // their full separation so branches do not collapse onto the spine.
  const visualLane = lane === 0 ? Math.min(28, Math.max(18, axis * 0.08)) : lane;
  const laneVector = vertical ? { x: visualLane, y: 0 } : { x: 0, y: visualLane };
  const control1 = add(add(edge.from, scale(fromDirection, sourceLead)), laneVector);
  const control2 = add(add(edge.to, scale(toDirection, targetLead)), laneVector);
  const pen = new Pen(edge.from);
  pen.curve(control1, control2, edge.to);
  return pen;
}

class Traffic {
  private samples: Array<{ point: Point; dx: number; dy: number }> = [];

  add(drawing: Drawing) {
    for (let index = 1; index < drawing.points.length; index++) {
      const from = drawing.points[index - 1]!;
      const to = drawing.points[index]!;
      const length = distance(from, to);
      if (length < EPS) continue;
      this.samples.push({
        point: mix(from, to, 0.5),
        dx: (to.x - from.x) / length,
        dy: (to.y - from.y) / length,
      });
    }
  }

  congestion(drawing: Drawing, edge: RouteEdge) {
    let total = 0;
    for (const point of drawing.points) {
      if (distance(point, edge.from) < 28 || distance(point, edge.to) < 28) continue;
      for (const sample of this.samples) {
        const gap = distance(point, sample.point);
        if (gap >= 30) continue;
        const dx = point.x - sample.point.x;
        const dy = point.y - sample.point.y;
        const length = Math.hypot(dx, dy) || 1;
        const dot = Math.abs((dx / length) * sample.dx + (dy / length) * sample.dy);
        total += (1 - gap / 30) ** 2 * (dot > 0.75 ? 24 : 2);
      }
    }
    return total;
  }
}

function fans(edges: RouteEdge[]): Map<string, Fan> {
  const result = new Map<string, Fan>(
    edges.map((edge) => [edge.id, { source: 0, target: 0, rank: 0 }]),
  );
  for (const end of ["source", "target"] as const) {
    const groups = new Map<string, RouteEdge[]>();
    for (const edge of edges) {
      const point = end === "source" ? edge.from : edge.to;
      const side = end === "source" ? edge.fromSide : edge.toSide;
      const key = edge[end] + ":" + side + ":" + number(point.x) + ":" + number(point.y);
      const group = groups.get(key);
      if (group) group.push(edge);
      else groups.set(key, [edge]);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const aPoint = end === "source" ? a.to : a.from;
        const bPoint = end === "source" ? b.to : b.from;
        return (aPoint.x - bPoint.x) || (aPoint.y - bPoint.y) || a.id.localeCompare(b.id);
      });
      group.forEach((edge, index) => {
        const fan = result.get(edge.id)!;
        fan[end] = (index - (group.length - 1) / 2) * LANE;
        fan.rank = Math.max(fan.rank, index);
      });
    }
  }
  return result;
}

function route(
  edge: RouteEdge,
  nodes: RouteRect[],
  fan: Fan,
  traffic: Traffic,
): { drawing: Drawing; clear: boolean } {
  const boxes = nodes.map((node) => expand(node, node.id===edge.source||node.id===edge.target?0:8));
  const span = distance(edge.from, edge.to);
  // Center first, then use independent side lanes. The lane is perpendicular
  // to the dominant travel direction, so branches remain readable.
  const lanes = [
    0,
    -LANE,
    LANE,
    -LANE * 2,
    LANE * 2,
    -LANE * 3,
    LANE * 3,
    -Math.max(150, span * 0.32),
    Math.max(150, span * 0.32),
  ];
  let best: Candidate | null = null;
  for (const lane of lanes) {
    const drawing = spline(edge, fan, lane);
    if (!pathClear(drawing.points, boxes)) continue;
    const congestion = traffic.congestion(drawing, edge);
    const length = drawing.points.reduce(
      (total, point, index) => (index ? total + distance(drawing.points[index - 1]!, point) : 0),
      0,
    );
    const score = length + congestion * 2 + Math.abs(lane) * 0.12;
    if (!best || score < best.score) best = { ...drawing, score, congestion };
    if (lane === 0 && congestion < 4) break;
  }
  if (best) return { drawing: best, clear: true };
  const outside=detour(edge,nodes,fan);
  if(outside)return {drawing:outside,clear:true};
  // Cards can temporarily overlap while a user drags them. Keep a smooth,
  // usable line in that transient state instead of drawing an elbow maze.
  return { drawing: spline(edge, fan, 0), clear: false };
}

function labelPosition(
  points: Point[],
  text: string,
  boxes: Box[],
  labels: Box[],
  otherRoutes: Point[][],
): Point | null {
  if (points.length < 2) return null;
  const width = Math.max(44, Math.min(180, Array.from(text).length * 13 + 18));
  const height = 26;
  const lengths = [0];
  for (let index = 1; index < points.length; index++) {
    lengths.push(lengths[index - 1]! + distance(points[index - 1]!, points[index]!));
  }
  const total = lengths[lengths.length - 1]!;
  for (const fraction of [0.5, 0.36, 0.64, 0.22, 0.78, 0.12, 0.88]) {
    const index = lengths.findIndex((value) => value >= total * fraction);
    const center = points[index];
    if (!center) continue;
    const label = {
      id: "label",
      left: center.x - width / 2,
      right: center.x + width / 2,
      top: center.y - height / 2,
      bottom: center.y + height / 2,
    };
    if ([...boxes, ...labels].some((box) =>
      label.left < box.right &&
      label.right > box.left &&
      label.top < box.bottom &&
      label.bottom > box.top
    )) continue;
    if (otherRoutes.some((route) => !pathClear(route, [label]))) continue;
    labels.push(label);
    return center;
  }
  return null;
}

export function routeEdges(input: RouteInput): Record<string, EdgeRoute> {
  const routes: Record<string, EdgeRoute> = {};
  const traffic = new Traffic();
  const fan = fans(input.edges);
  const exception = (edge: RouteEdge) =>
    ["拒绝", "否定", "未识别", "人工跟进"].includes(edge.label) ? 1 : 0;
  // Keep the intended progression first. Exception routes then pick lanes
  // around the already visible main flow.
  const edges = [...input.edges].sort(
    (a, b) => exception(a) - exception(b) || a.id.localeCompare(b.id),
  );
  for (const edge of edges) {
    const result = route(edge, input.nodes, fan.get(edge.id)!, traffic);
    routes[edge.id] = { ...result.drawing, label: null, clear: result.clear };
    traffic.add(result.drawing);
  }
  const boxes = input.nodes.map((node) => expand(node, 10));
  const labels: Box[] = [];
  for (const edge of edges) {
    const current = routes[edge.id]!;
    current.label = labelPosition(
      current.points,
      edge.label,
      boxes,
      labels,
      edges.filter((other) => other.id !== edge.id).map((other) => routes[other.id]!.points),
    );
  }
  return routes;
}

// Used only while the worker is warming up. It is deliberately a single smooth
// curve so the fallback cannot reintroduce the old rectangular path.
export function roundedRoute(points: Point[], _radius = 64): string {
  if (points.length < 2) return "";
  const from = points[0]!;
  const to = points[points.length - 1]!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lead = Math.max(48, Math.min(160, Math.max(Math.abs(dx), Math.abs(dy)) * 0.26));
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const first = {
    x: from.x + (vertical ? 0 : Math.sign(dx) * lead),
    y: from.y + (vertical ? Math.sign(dy) * lead : 0),
  };
  const second = {
    x: to.x - (vertical ? 0 : Math.sign(dx) * lead),
    y: to.y - (vertical ? Math.sign(dy) * lead : 0),
  };
  return "M " + coords(from) + " C " + coords(first) + " " + coords(second) + " " + coords(to);
}
