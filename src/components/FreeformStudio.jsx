import {useEffect, useRef, useState} from 'react';
import {ArrowRight, Compass, Eraser, Pencil, Play, RotateCcw, Spline, Undo2} from 'lucide-react';
import {alignFreeformDrawing, inkBounds, prepareFreeformArt} from '../engine/freeform-fish.js';
import {KoiRenderer} from '../engine/koi-renderer.js';
import {updateSwimMotion} from '../engine/koi-motion.js';
import './FreeformStudio.css';

const WIDTH = 640, HEIGHT = 320;
const modes = [
  ['shape', '画轮廓', Spline], ['brush', '画花纹', Pencil],
  ['erase', '橡皮', Eraser], ['heading', '定鱼头', Compass],
];
const hints = {
  shape:'沿鱼身或鱼鳍描一圈，松手填色。可以分几笔添上鱼尾。',
  brush:'用画笔添上眼睛、花纹或细长的鱼须。',
  erase:'擦去的地方会透出池水。',
  heading:'从画面上的鱼尾向鱼头划一笔，箭头指向游动方向。',
};

function pointOnBoard(event, board) {
  const rect = board.getBoundingClientRect();
  return {
    x:Math.max(0, Math.min(WIDTH, (event.clientX - rect.left) * WIDTH / rect.width)),
    y:Math.max(0, Math.min(HEIGHT, (event.clientY - rect.top) * HEIGHT / rect.height)),
  };
}

function drawStroke(board, stroke) {
  const ctx = board.getContext('2d', {willReadFrequently:true});
  ctx.putImageData(stroke.before, 0, 0);
  const first = stroke.points[0];
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.tool === 'shape' ? 1.5 : stroke.width;
  if (stroke.tool === 'erase') ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  if (stroke.tool === 'shape' && stroke.points.length >= 3) {
    ctx.closePath();
    ctx.fill('evenodd');
  }
  if (stroke.points.length === 1) {
    ctx.beginPath();
    ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.stroke();
  ctx.restore();
}

function SwimPreview({art, size, reducedMotion}) {
  const canvas = useRef(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useEffect(() => {
    const ctx = canvas.current.getContext('2d');
    const painter = new KoiRenderer(ctx);
    painter.images.set('draft', {freeform:prepareFreeformArt(art)});
    const fish = {custom:{texture:'draft', appearance:'freeform-v1'}, width:.12, phase:0,
      depth:1, speed:22, velocity:22, seed:7, turn:0, bodyBend:0};
    let frame, last = 0, time = 0;
    function render(now) {
      const dt = last ? Math.min(.05, (now - last) / 1000) : 0;
      last = now;
      time += dt;
      const travel = time * (reducedMotion ? .19 : .38);
      fish.length = 118 * sizeRef.current;
      fish.x = WIDTH / 2 + 116 * Math.sin(travel);
      // Glide along an oval, with the nose tangent to the route into each turn.
      const angle = Math.atan2(42 * Math.sin(travel), 116 * Math.cos(travel));
      fish.y = HEIGHT / 2 - 42 * Math.cos(travel);
      const delta = angle - (fish.heading ?? angle);
      fish.turn = dt ? Math.atan2(Math.sin(delta), Math.cos(delta)) / dt : 0;
      fish.heading = angle;
      fish.velocity = Math.hypot(116 * Math.cos(travel), 42 * Math.sin(travel)) * (reducedMotion ? .19 : .38);
      updateSwimMotion(fish, dt, time, reducedMotion);
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      painter.drawFish(fish, true);
      painter.drawFish(fish, false);
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [art, reducedMotion]);
  return <canvas ref={canvas} width={WIDTH * 2} height={HEIGHT * 2} aria-label="自由鱼形试游预览"/>;
}

export default function FreeformStudio({visible, onSave, fishCount, colors, reducedMotion}) {
  const board = useRef(null), active = useRef(null), history = useRef([]);
  const [tool, setTool] = useState('shape'), [color, setColor] = useState(colors[0]);
  const [brush, setBrush] = useState(12), [heading, setHeading] = useState(0);
  const [bounds, setBounds] = useState(null), [art, setArt] = useState(null);
  const [size, setSize] = useState(1), [name, setName] = useState('小自在');
  const [busy, setBusy] = useState(false), [gesture, setGesture] = useState(null);
  const ctx = () => board.current.getContext('2d', {willReadFrequently:true});

  function remember(before) {
    history.current.push({pixels:before, heading, bounds});
    if (history.current.length > 20) history.current.shift();
  }

  function begin(event) {
    if (event.button !== 0 || !event.isPrimary || active.current || art) return;
    event.preventDefault();
    const first = pointOnBoard(event, board.current);
    const stroke = {id:event.pointerId, tool, color, width:brush, points:[first],
      before:ctx().getImageData(0, 0, WIDTH, HEIGHT)};
    active.current = stroke;
    board.current.setPointerCapture(event.pointerId);
    setBusy(true);
    if (tool !== 'heading') drawStroke(board.current, stroke);
  }

  function move(event) {
    const stroke = active.current;
    if (stroke?.id !== event.pointerId) return;
    const samples = event.nativeEvent.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) {
      const next = pointOnBoard(sample, board.current), last = stroke.points.at(-1);
      if (Math.hypot(next.x - last.x, next.y - last.y) >= .75) stroke.points.push(next);
    }
    if (stroke.tool === 'heading') setGesture([stroke.points[0], stroke.points.at(-1)]);
    else drawStroke(board.current, stroke);
  }

  function finish(event, cancel = false) {
    const stroke = active.current;
    if (stroke?.id !== event.pointerId) return;
    if (!cancel) move(event);
    active.current = null;
    if (cancel) ctx().putImageData(stroke.before, 0, 0);
    else if (stroke.tool === 'heading') {
      const first = stroke.points[0], last = stroke.points.at(-1);
      if (Math.hypot(last.x - first.x, last.y - first.y) >= 5) {
        remember(stroke.before);
        setHeading(Math.atan2(last.y - first.y, last.x - first.x));
      }
    } else {
      remember(stroke.before);
      setBounds(inkBounds(board.current));
    }
    if (board.current.hasPointerCapture(event.pointerId)) board.current.releasePointerCapture(event.pointerId);
    setBusy(false);
    setGesture(null);
  }

  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    ctx().putImageData(previous.pixels, 0, 0);
    setHeading(previous.heading);
    setBounds(previous.bounds);
  }

  function clear() {
    remember(ctx().getImageData(0, 0, WIDTH, HEIGHT));
    ctx().clearRect(0, 0, WIDTH, HEIGHT);
    setBounds(null);
    setHeading(0);
    setTool('shape');
  }

  const makeArt = () => alignFreeformDrawing(board.current, bounds, heading);
  function save() {
    const image = art || makeArt();
    if (image && name.trim() && fishCount < 12) onSave({id:crypto.randomUUID(), name:name.trim(), size,
      appearance:'freeform-v1', texture:image.toDataURL('image/png')});
  }

  return <div hidden={!visible} className="freeform-studio">
    <div className="freeform-toolbar">
      <div role="group" aria-label="自由绘画工具">
        {modes.map(([id, label, Icon]) => <button key={id} aria-pressed={tool === id && !art}
          disabled={busy || !!art || (id === 'heading' && !bounds)} onClick={() => setTool(id)}>
          <Icon size={15}/>{label}</button>)}
      </div>
      <button aria-pressed={!!art} disabled={!bounds || busy} onClick={() => setArt(art ? null : makeArt())}>
        {art ? <Pencil size={15}/> : <Play size={15}/>} {art ? '继续绘制' : '试游'}</button>
    </div>
    <div className="freeform-board drawing-board">
      <canvas hidden={!!art} ref={board} width={WIDTH} height={HEIGHT} aria-label="自由鱼形画布"
        onPointerDown={begin} onPointerMove={move} onPointerUp={finish}
        onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)}/>
      {!bounds && !busy && <div className="freeform-prompt"><Spline size={28}/><span>画下第一笔鱼形</span></div>}
      {visible && art && <SwimPreview art={art} size={size} reducedMotion={reducedMotion}/>}
      {gesture && <svg className="freeform-gesture" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
        <path d={`M ${gesture[0].x} ${gesture[0].y} L ${gesture[1].x} ${gesture[1].y}`} stroke="currentColor" strokeWidth="3" strokeDasharray="6 4"/>
        <circle cx={gesture[1].x} cy={gesture[1].y} r="5" fill="currentColor"/>
      </svg>}
    </div>
    <div className="freeform-note"><span>{art ? '试游中，可返回画板调整。' : hints[tool]}</span>
      <span aria-label={`鱼头方向 ${Math.round(heading * 180 / Math.PI)} 度`}>鱼头 <ArrowRight size={15} style={{transform:`rotate(${heading}rad)`}}/></span>
    </div>
    {!art && <div className="drawing-tools">
        <div className="swatches">{colors.map(c => <button key={c} aria-label={`颜料 ${c}`} style={{background:c}}
          className={color === c ? 'active' : ''} onClick={() => setColor(c)}/>)}
          <label className="custom-color" title="自选颜色"><input aria-label="自由绘画颜色" type="color" value={color} onChange={e => setColor(e.target.value)}/></label>
        </div>
        <div className="tool-group">
          <button className="icon-button" title="撤销" aria-label="撤销自由绘画" disabled={busy || !history.current.length} onClick={undo}><Undo2 size={18}/></button>
          <button className="icon-button" title="清空画布" aria-label="清空自由画布" disabled={busy || !bounds} onClick={clear}><RotateCcw size={17}/></button>
        </div>
      </div>}
    <div className="studio-sliders">
      {!art && (tool === 'brush' || tool === 'erase') && <label className="brush-control">笔触大小<input type="range" min="2" max="60" value={brush} onChange={e => setBrush(Number(e.target.value))}/><span>{brush}</span></label>}
      <label className="brush-control">鱼的大小<input type="range" min=".55" max="1.8" step=".05" value={size} onChange={e => setSize(Number(e.target.value))}/><span>{Math.round(size * 100)}%</span></label>
    </div>
    <footer className="studio-footer"><label>给它一个名字<input aria-label="自由鱼名字" maxLength="12" value={name} onChange={e => setName(e.target.value)}/></label>
      <button className="primary-button" disabled={busy || !bounds || !name.trim() || fishCount >= 12} onClick={save}>放入池塘 <ArrowRight size={17}/></button></footer>
    {fishCount >= 12 && <p className="inline-note">池塘里已有 12 尾自绘鱼，可先在「我的锦鲤」中移走一尾。</p>}
  </div>;
}
