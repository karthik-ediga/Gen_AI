const appEl = document.getElementById('app');
const heroEl = document.getElementById('hero');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const startBtn = document.getElementById('startBtn');
const composerEl = document.getElementById('composer');

const AUTO_SCROLL_THRESHOLD = 140;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const isFinePointer = window.matchMedia('(pointer: fine)');

let isPinnedToBottom = true;
let inFlight = null;

function enterChat() {
  appEl.classList.add('is-chat');
  heroEl.classList.add('is-chat');
  requestAnimationFrame(() => inputEl.focus());
}

function checkPinnedToBottom() {
  const distanceFromBottom = messagesEl.scrollHeight - (messagesEl.scrollTop + messagesEl.clientHeight);
  return distanceFromBottom <= AUTO_SCROLL_THRESHOLD;
}

messagesEl.addEventListener('scroll', () => {
  isPinnedToBottom = checkPinnedToBottom();
}, { passive: true });

function scrollToBottom(force = false) {
  if (!force && !isPinnedToBottom) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function formatReply(reply) {
  if (reply == null) return '';
  if (typeof reply === 'string') return reply;
  if (typeof reply === 'object') {
    if (reply.error) return String(reply.error);
    try {
      return JSON.stringify(reply, null, 2);
    } catch {
      return String(reply);
    }
  }
  return String(reply);
}

function renderMarkdown(text) {
  if (!text) return '';
  try {
    if (window.marked) {
      if (!window.customRenderer) {
        window.customRenderer = new marked.Renderer();
        window.customRenderer.code = function (code, lang) {
          const rawCode = typeof code === 'object' && code.text !== undefined ? code.text : code;
          const language = (typeof code === 'object' ? code.lang : lang) || '';
          const validLang = language && window.hljs && window.hljs.getLanguage(language) ? language : 'plaintext';
          const highlighted = window.hljs
            ? window.hljs.highlight(String(rawCode), { language: validLang }).value
            : escapeHtml(String(rawCode));
          return `<pre><code class="language-${validLang}">${highlighted}</code></pre>`;
        };
        marked.setOptions({ breaks: true, gfm: true });
      }
      return sanitizeHtml(marked.parse(text, { renderer: window.customRenderer }));
    }
  } catch (err) {
    console.warn('Markdown parse fallback:', err);
  }
  return escapeHtml(text).replace(/\n/g, '<br />');
}

function addMessage(text, role) {
  const bubble = document.createElement('div');
  bubble.className = `message ${role}`;
  const content = document.createElement('div');
  content.className = 'message-content';
  if (role === 'assistant' && text === 'Thinking…') {
    content.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  } else {
    content.innerHTML = renderMarkdown(text);
  }
  bubble.appendChild(content);
  messagesEl.appendChild(bubble);
  requestAnimationFrame(() => scrollToBottom(true));
  return bubble;
}

function addWelcomeMessage() {
  addMessage('Hi! 👋 What can I help you with today?', 'assistant');
}

function streamAssistantReply(text, bubble) {
  const contentEl = bubble.querySelector('.message-content');
  const fullText = String(text || '').trim();

  if (!fullText) {
    contentEl.textContent = 'No response generated.';
    return;
  }

  if (prefersReducedMotion.matches || fullText.length < 48) {
    contentEl.innerHTML = renderMarkdown(fullText);
    scrollToBottom();
    return;
  }

  let index = 0;
  const charsPerFrame = fullText.length > 1200 ? 18 : 8;

  function step() {
    if (index < fullText.length) {
      index = Math.min(index + charsPerFrame, fullText.length);
      contentEl.innerHTML = escapeHtml(fullText.slice(0, index)).replace(/\n/g, '<br />');
      scrollToBottom();
      requestAnimationFrame(step);
    } else {
      contentEl.innerHTML = renderMarkdown(fullText);
      scrollToBottom();
    }
  }

  requestAnimationFrame(step);
}

async function sendMessage(customText) {
  if (sendBtn.disabled) return;
  const message = (customText || inputEl.value).trim();
  if (!message) return;

  enterChat();
  addMessage(message, 'user');
  inputEl.value = '';
  sendBtn.disabled = true;

  if (inFlight) {
    inFlight.abort();
  }
  const controller = new AbortController();
  inFlight = controller;

  const thinkingBubble = addMessage('Thinking…', 'assistant');

  try {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = { error: 'The assistant returned an invalid response.' };
    }

    if (thinkingBubble.parentNode) {
      messagesEl.removeChild(thinkingBubble);
    }

    const reply = formatReply(data.reply || data.error || 'No response received.');
    const assistantBubble = addMessage('', 'assistant');
    streamAssistantReply(response.ok ? reply : `⚠️ ${reply}`, assistantBubble);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (thinkingBubble.parentNode) {
      messagesEl.removeChild(thinkingBubble);
    }
    const assistantBubble = addMessage('', 'assistant');
    streamAssistantReply('Unable to reach the assistant right now. Please try again in a moment.', assistantBubble);
  } finally {
    if (inFlight === controller) inFlight = null;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

if (composerEl) {
  composerEl.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
  });
} else {
  sendBtn.addEventListener('click', () => sendMessage());
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
    }
  });
}

if (startBtn) {
  startBtn.addEventListener('click', () => {
    enterChat();
  });
}

function setupParticles() {
  const particlesCanvas = document.getElementById('particles');
  if (!particlesCanvas) return;

  const reduceMotion = () => prefersReducedMotion.matches;
  const useParticles = () => !reduceMotion() && window.innerWidth >= 720 && isFinePointer.matches;

  if (!useParticles()) {
    particlesCanvas.style.display = 'none';
    return;
  }

  const ctx = particlesCanvas.getContext('2d', { alpha: true, desynchronized: true });
  let pointer = { x: null, y: null };
  const particles = [];
  let running = true;
  let rafId = 0;
  let resizeTimer = 0;

  function particleCount() {
    return Math.min(36, Math.max(12, Math.floor(window.innerWidth / 48)));
  }

  function resizeCanvas() {
    if (!useParticles()) {
      running = false;
      particlesCanvas.style.display = 'none';
      cancelAnimationFrame(rafId);
      return;
    }
    particlesCanvas.style.display = '';
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    particlesCanvas.width = window.innerWidth * dpr;
    particlesCanvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  }

  function initParticles() {
    particles.length = 0;
    const count = particleCount();
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.2 + 0.4,
        alpha: Math.random() * 0.35 + 0.12,
      });
    }
  }

  function drawParticles() {
    if (!running) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -4 || p.x > window.innerWidth + 4) p.vx *= -1;
      if (p.y < -4 || p.y > window.innerHeight + 4) p.vy *= -1;

      if (pointer.x !== null) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 10000 && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const force = (100 - dist) / 100;
          p.x += (dx / dist) * force * 0.5;
          p.y += (dy / dist) * force * 0.5;
        }
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${p.alpha})`;
      ctx.fill();
    }
    rafId = requestAnimationFrame(drawParticles);
  }

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 180);
  }, { passive: true });

  window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 180);
  }, { passive: true });

  window.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    running = document.visibilityState === 'visible' && useParticles();
    if (running) drawParticles();
    else cancelAnimationFrame(rafId);
  });

  prefersReducedMotion.addEventListener('change', resizeCanvas);

  resizeCanvas();
  if (useParticles()) drawParticles();
}

setupParticles();
addWelcomeMessage();
