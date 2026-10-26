// 轻量 DOM 物理：窗口边缘碰撞 + 重力 + 抛掷速度。物理位置不参与饭量结算。
export class BasinPhysics {
  constructor(element, { onFeed, isFeedTarget, onRetrieve }) {
    this.el = element; this.onFeed = onFeed; this.isFeedTarget = isFeedTarget; this.onRetrieve = onRetrieve;
    this.width = 142; this.height = 110;
    this.x = Math.max(10, innerWidth - 185); this.y = Math.max(10, innerHeight - this.height - 8);
    this.vx = 0; this.vy = 0; this.angle = 0; this.spin = 0; this.drag = null; this.onHead = false; this.rice = 0;
    this.gravity = 1700; this.bounce = .62;
    this.last = performance.now();
    element.addEventListener('pointerdown', e => this.grab(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.release(e));
    window.addEventListener('pointercancel', () => this.cancel());
    window.addEventListener('blur', () => this.cancel());
    this.frame = this.frame.bind(this); requestAnimationFrame(this.frame);
  }
  setState(basin) {
    this.onHead = basin.place === 'head'; this.rice = basin.rice;
    this.el.hidden = this.onHead;
    this.el.querySelector('img').src = `/assets/basin-${basin.rice > 0 ? 'full' : 'empty'}-tight.png`;
    this.el.setAttribute('aria-label', basin.rice > 0 ? '装满饭的铁盆，可拖给大肥鱼或随便抛掷' : '空铁盆，可拖动和抛掷');
    if (this.onHead && this.drag?.source !== 'head') this.cancel();
  }
  begin(e, source = 'world') {
    e.preventDefault(); e.stopPropagation();
    this.drag = { id: e.pointerId, source, x: e.clientX, y: e.clientY, lastAt: performance.now(), vx: 0, vy: 0, moved: false };
    this.x = e.clientX - this.width / 2; this.y = e.clientY - this.height / 2;
    this.vx = this.vy = this.spin = this.angle = 0;
  }
  grab(e) {
    if (e.button !== 0 || this.onHead) return;
    this.el.setPointerCapture(e.pointerId); this.begin(e);
  }
  async takeFromHead(e, captureElement) {
    if (e.button !== 0 || !this.onHead) return;
    captureElement.setPointerCapture(e.pointerId); this.begin(e, 'head');
    this.pendingRetrieve = true;
    const ok = await this.onRetrieve(); this.pendingRetrieve = false;
    if (!ok) { this.cancel(); return; }
    this.onHead = false; this.el.hidden = false;
  }
  move(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const now = performance.now(), dt = Math.max(.008, (now - this.drag.lastAt) / 1000);
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if (Math.hypot(dx, dy) > 2) this.drag.moved = true;
    this.drag.vx = Math.max(-2000, Math.min(2000, .35 * this.drag.vx + .65 * dx / dt));
    this.drag.vy = Math.max(-2000, Math.min(2000, .35 * this.drag.vy + .65 * dy / dt));
    this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.lastAt = now;
    this.x = e.clientX - this.width/2; this.y = e.clientY - this.height/2;
    document.getElementById('drop-zone')?.classList.toggle('drag-over', this.rice > 0 && this.isFeedTarget(e.clientX, e.clientY));
  }
  release(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const recent = performance.now() - this.drag.lastAt < 100;
    this.vx = recent ? this.drag.vx : 0; this.vy = recent ? this.drag.vy : 0;
    this.spin = this.vx * .06;
    const feed = !this.pendingRetrieve && this.rice > 0 && this.isFeedTarget(e.clientX, e.clientY);
    this.drag = null;
    document.getElementById('drop-zone')?.classList.remove('drag-over');
    if (this.y >= Math.max(0, innerHeight - this.height - 4) && Math.hypot(this.vx, this.vy) > 300) this.squash();
    if (feed) this.onFeed();
  }
  cancel() { this.drag = null; document.getElementById('drop-zone')?.classList.remove('drag-over'); }
  recall(x = innerWidth - 185, y = innerHeight - 220) {
    if (this.onHead) return;
    this.drag = null; this.x = x; this.y = y; this.vx = -130; this.vy = -180; this.spin = -15;
  }
  frame(now) {
    const dt = Math.min(.032, Math.max(0, (now - this.last) / 1000)); this.last = now;
    if (!this.onHead && !this.drag) this.angle += this.spin * dt;
    // 旋转后的外接矩形也必须留在视口里，不能只限制未旋转的按钮边框。
    const radians = Math.abs(Math.max(-28, Math.min(28, this.angle))) * Math.PI / 180;
    const wall = Math.max(0, innerWidth - this.width);
    const bottom = Math.max(0, innerHeight - this.height - 4);
    const marginX = Math.min(wall / 2, Math.max(0, (this.width * Math.cos(radians) + this.height * Math.sin(radians) - this.width) / 2));
    const marginY = Math.min(bottom / 2, Math.max(0, (this.height * Math.cos(radians) + this.width * Math.sin(radians) - this.height) / 2));
    const left = marginX, right = wall - marginX, ceiling = marginY, floor = bottom - marginY;
    if (!this.onHead && !this.drag) {
      if (this.y < floor - .5 || this.vy < 0) this.vy += this.gravity * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.x < left) { this.x = left; this.vx = Math.abs(this.vx) * this.bounce; this.spin *= -.6; }
      if (this.x > right) { this.x = right; this.vx = -Math.abs(this.vx) * this.bounce; this.spin *= -.6; }
      if (this.y < ceiling) { this.y = ceiling; this.vy = Math.abs(this.vy) * this.bounce; }
      if (this.y >= floor) {
        const impact = Math.abs(this.vy);
        this.y = floor; this.vy = -Math.abs(this.vy) * this.bounce; this.vx *= .86; this.spin *= .7;
        if (Math.abs(this.vy) < 45) this.vy = 0;
        if (Math.abs(this.vx) < 8) this.vx = 0;
        if (!this.vy && !this.vx) { this.spin = 0; this.angle *= Math.max(0, 1 - 8*dt); }
        if (impact > 300) this.squash();
      }
    }
    if (!this.onHead) {
      this.x = Math.max(left, Math.min(right, this.x));
      this.y = Math.max(ceiling, Math.min(floor, this.y));
    }
    this.el.style.transform = `translate(${this.x}px, ${this.y}px) rotate(${Math.max(-28, Math.min(28, this.angle))}deg)`;
    requestAnimationFrame(this.frame);
  }
  squash() {
    if (!this.el.classList) return;
    this.el.classList.remove('landed'); void this.el.offsetWidth; this.el.classList.add('landed');
  }
}
