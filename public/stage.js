// @ts-check
/**
 * The home page's stage: a field of time slots booking themselves behind the copy, brighter
 * where the pointer is, and the flow diagram answering the race. A slot is held (violet) and
 * then booked (amber) or released, the way a hold works in the API. One canvas, redrawn a few
 * times a second, stopped off screen and under reduced motion.
 */

const canvas = /** @type {HTMLCanvasElement | null} */ (document.querySelector("[data-slotfield]"));
const flow = /** @type {HTMLElement | null} */ (document.querySelector("[data-flow]"));
const race = document.querySelector("[data-race]");

const CELL = 18;
const GAP = 7;
const HOLD_MS = 1600;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (canvas) {
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  /** @type {{ state: 0 | 1 | 2, at: number }[]} 0 free, 1 held, 2 booked */
  let cells = [];
  let cols = 0;
  let rows = 0;
  let dpr = 1;
  const pointer = { x: -1e4, y: -1e4 };
  let visible = true;

  const size = () => {
    const box = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    const c = Math.ceil(box.width / (CELL + GAP));
    const r = Math.ceil(box.height / (CELL + GAP));
    if (c !== cols || r !== rows) {
      cols = c;
      rows = r;
      // A calendar is never empty: start a fifth booked, at rest.
      cells = Array.from({ length: cols * rows }, () => ({ state: Math.random() < 0.2 ? 2 : 0, at: -1e5 }));
    }
    draw(performance.now());
  };

  /** @param {number} now */
  const draw = (now) => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < cells.length; i++) {
      const x = (i % cols) * (CELL + GAP) + GAP;
      const y = Math.floor(i / cols) * (CELL + GAP) + GAP;
      const near = Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / 140);
      const cell = cells[i];
      const age = now - cell.at;
      let fill;
      if (cell.state === 1) {
        const pulse = 0.55 + 0.45 * Math.sin(age / 120);
        fill = `rgba(182, 156, 255, ${0.35 + 0.4 * pulse})`;
      } else if (cell.state === 2) {
        // A fresh booking flares, then settles to a warm rest.
        const flare = Math.max(0, 1 - age / 900);
        fill = `rgba(246, 196, 83, ${0.11 + 0.55 * flare + 0.22 * near})`;
      } else fill = `rgba(160, 170, 190, ${0.035 + 0.1 * near})`;
      g.fillStyle = fill;
      g.beginPath();
      g.roundRect(x, y, CELL, CELL, 4);
      g.fill();
    }
  };

  /** @param {number} now */
  const step = (now) => {
    for (let n = 0; n < 2; n++) {
      const cell = cells[Math.floor(Math.random() * cells.length)];
      if (cell && cell.state === 0) [cell.state, cell.at] = [1, now];
    }
    for (const cell of cells) {
      if (cell.state === 1 && now - cell.at > HOLD_MS) [cell.state, cell.at] = Math.random() < 0.7 ? [2, now] : [0, now];
      // Bookings end, as the day moves on, so the field never fills.
      else if (cell.state === 2 && now - cell.at > 9000 && Math.random() < 0.004) cell.state = 0;
    }
  };

  size();
  addEventListener("resize", size);
  if (!reduced) {
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const stage = canvas.parentElement;
    stage?.addEventListener("pointermove", (e) => {
      const box = canvas.getBoundingClientRect();
      pointer.x = e.clientX - box.left;
      pointer.y = e.clientY - box.top;
    });
    stage?.addEventListener("pointerleave", () => {
      pointer.x = pointer.y = -1e4;
    });
    let lastStep = 0;
    let lastDraw = 0;
    const loop = (/** @type {number} */ now) => {
      requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      if (now - lastStep > 260) {
        step(now);
        lastStep = now;
      }
      if (now - lastDraw > 66) {
        draw(now);
        lastDraw = now;
      }
    };
    requestAnimationFrame(loop);
  }
}

// The race announces itself; the diagram speeds up while it runs and lights the webhook if one won.
if (flow && race) {
  race.addEventListener("race", (/** @type {any} */ e) => {
    if (e.detail === "start") {
      flow.dataset.burst = "";
      delete flow.dataset.won;
    } else {
      delete flow.dataset.burst;
      if (e.detail === "won") {
        flow.dataset.won = "";
        setTimeout(() => delete flow.dataset.won, 2600);
      }
    }
  });
}

// Loaded as a module; this keeps its top-level names its own.

// The feature cards catch the light where the pointer is.
for (const card of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".feature"))) {
  card.addEventListener("pointermove", (e) => {
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - box.left}px`);
    card.style.setProperty("--my", `${e.clientY - box.top}px`);
  });
}

export {};
