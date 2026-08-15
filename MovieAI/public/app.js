const appEl = document.getElementById('app');
const heroEl = document.getElementById('hero');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const startBtn = document.getElementById('startBtn');
const sampleBtn = document.getElementById('sampleBtn');

const AUTO_SCROLL_THRESHOLD = 140;
let isPinnedToBottom = true;
let isScrollTicking = false;

function enterChat() {
  appEl.classList.add('is-chat');
  heroEl.classList.add('is-chat');
  inputEl.focus();

  if (window.innerWidth <= 960) {
    const chatShell = document.getElementById('chatShell');
    if (chatShell) {
      chatShell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
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

function renderMarkdown(text) {
  if (!text) return '';
  try {
    if (window.marked) {
      if (!window.customRenderer) {
        window.customRenderer = new marked.Renderer();
        window.customRenderer.code = function(code, lang) {
          const rawCode = typeof code === 'object' && code.text !== undefined ? code.text : code;
          const language = (typeof code === 'object' ? code.lang : lang) || '';
          const validLang = language && window.hljs && window.hljs.getLanguage(language) ? language : 'plaintext';
          const highlighted = window.hljs ? window.hljs.highlight(rawCode, { language: validLang }).value : rawCode;
          return `<pre><code class="language-${validLang}">${highlighted}</code></pre>`;
        };
        marked.setOptions({ breaks: true, gfm: true });
      }
      return marked.parse(text, { renderer: window.customRenderer });
    }
  } catch (err) {
    console.warn('Markdown parse fallback:', err);
  }
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />');
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
  requestAnimationFrame(() => scrollToBottom());
  return bubble;
}

function addWelcomeMessage() {
  addMessage('Hi! I can help you discover films, compare stories, and find something perfect for tonight.', 'assistant');
}

function streamAssistantReply(text, bubble) {
  const contentEl = bubble.querySelector('.message-content');
  const fullText = String(text || '').trim();

  if (!fullText) {
    contentEl.innerHTML = 'No response generated.';
    return;
  }

  let index = 0;
  let lastRenderTime = 0;
  const charsPerFrame = 4; // Advance 4 characters per RAF frame for fast, smooth text streaming
  const renderInterval = 35; // Re-parse markdown every 35ms to eliminate layout thrashing

  function step(timestamp) {
    if (index < fullText.length) {
      index = Math.min(index + charsPerFrame, fullText.length);
      
      // Batch markdown updates to keep 60fps frame rate smooth
      if (timestamp - lastRenderTime > renderInterval || index >= fullText.length) {
        contentEl.innerHTML = renderMarkdown(fullText.slice(0, index));
        lastRenderTime = timestamp;
        scrollToBottom();
      }

      requestAnimationFrame(step);
    } else {
      contentEl.innerHTML = renderMarkdown(fullText);
      scrollToBottom(true);
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

  const thinkingBubble = addMessage('Thinking…', 'assistant');

  try {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await response.json();
    messagesEl.removeChild(thinkingBubble);
    const reply = data.reply || data.error || 'No response received.';
    const assistantBubble = addMessage('', 'assistant');
    if (!response.ok) {
      streamAssistantReply(`⚠️ ${reply}`, assistantBubble);
    } else {
      streamAssistantReply(reply, assistantBubble);
    }
  } catch (error) {
    if (thinkingBubble.parentNode) {
      messagesEl.removeChild(thinkingBubble);
    }
    const assistantBubble = addMessage('', 'assistant');
    streamAssistantReply('Unable to reach the assistant right now. Please try again in a moment.', assistantBubble);
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

sendBtn.addEventListener('click', () => sendMessage());
inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendMessage();
  }
});
if (startBtn) {
  startBtn.addEventListener('click', () => {
    enterChat();
    inputEl.focus();
  });
}
if (sampleBtn) {
  sampleBtn.addEventListener('click', () => {
    enterChat();
    inputEl.value = 'Recommend a moody sci-fi film with a strong ending.';
    inputEl.focus();
  });
}

// Optimized Canvas Particles Background
const particlesCanvas = document.getElementById('particles');
if (particlesCanvas) {
  const ctx = particlesCanvas.getContext('2d', { alpha: true });
  let pointer = { x: null, y: null };
  const particles = [];

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    particlesCanvas.width = window.innerWidth * dpr;
    particlesCanvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  }

  function initParticles() {
    particles.length = 0;
    const count = Math.min(60, Math.floor(window.innerWidth / 20));
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.2 + 0.4,
        alpha: Math.random() * 0.4 + 0.15
      });
    }
  }

  function drawParticles() {
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
        if (distSq < 10000) { // 100px radius squared
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
    requestAnimationFrame(drawParticles);
  }

  let moveTimeout;
  window.addEventListener('resize', resizeCanvas, { passive: true });
  window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 100);
  }, { passive: true });
  window.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => { pointer.x = null; pointer.y = null; }, 2000);
  }, { passive: true });

  resizeCanvas();
  drawParticles();
}

addWelcomeMessage();
