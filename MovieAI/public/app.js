const appEl = document.getElementById('app');
const heroEl = document.getElementById('hero');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const startBtn = document.getElementById('startBtn');
const sampleBtn = document.getElementById('sampleBtn');

function enterChat() {
  appEl.classList.add('is-chat');
  heroEl.classList.add('is-chat');
  inputEl.focus();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(text, role) {
  const bubble = document.createElement('div');
  bubble.className = `message ${role}`;
  const content = document.createElement('div');
  content.className = 'message-content';
  if (role === 'assistant' && text === 'Thinking…') {
    content.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  } else {
    content.innerHTML = text;
  }
  bubble.appendChild(content);
  messagesEl.appendChild(bubble);
  requestAnimationFrame(scrollToBottom);
  return bubble;
}

function addWelcomeMessage() {
  addMessage('Hi! I can help you discover films, compare stories, and find something perfect for tonight.', 'assistant');
}

function renderMarkdown(text) {
  if (window.marked) {
    const renderer = new marked.Renderer();
    renderer.code = function(code, lang) {
      const validLang = lang && window.hljs && window.hljs.getLanguage(lang) ? lang : 'plaintext';
      const highlighted = window.hljs.highlight(code, { language: validLang }).value;
      return `<pre><code class="language-${validLang}">${highlighted}</code></pre>`;
    };
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text, { renderer });
  }
  return text.replace(/\n/g, '<br />');
}

function streamAssistantReply(text, bubble) {
  const contentEl = bubble.querySelector('.message-content');
  let index = 0;
  const chunkDelay = 16;
  const fullText = String(text || '').trim();

  if (!fullText) {
    contentEl.innerHTML = 'No response generated.';
    return;
  }

  const step = () => {
    if (index >= fullText.length) {
      contentEl.innerHTML = renderMarkdown(fullText);
      scrollToBottom();
      return;
    }

    const nextChunk = fullText.slice(0, index + 1);
    contentEl.innerHTML = renderMarkdown(nextChunk);
    index += 1;
    scrollToBottom();
    window.setTimeout(step, chunkDelay);
  };

  step();
}

async function sendMessage(customText) {
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
    messagesEl.removeChild(thinkingBubble);
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
startBtn.addEventListener('click', () => {
  enterChat();
  inputEl.focus();
});
sampleBtn.addEventListener('click', () => {
  enterChat();
  inputEl.value = 'Recommend a moody sci-fi film with a strong ending.';
  inputEl.focus();
});

const particlesCanvas = document.getElementById('particles');
const ctx = particlesCanvas.getContext('2d');
let w = 0;
let h = 0;
let pointer = { x: null, y: null };
const particles = [];

function resizeCanvas() {
  w = particlesCanvas.width = window.innerWidth * window.devicePixelRatio;
  h = particlesCanvas.height = window.innerHeight * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  initParticles();
}

function initParticles() {
  particles.length = 0;
  const count = Math.min(100, Math.floor(window.innerWidth / 15));
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.4 + 0.4,
      alpha: Math.random() * 0.5 + 0.2
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
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        const force = (120 - dist) / 120;
        p.x += (dx / dist) * force * 0.8;
        p.y += (dy / dist) * force * 0.8;
      }
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${p.alpha})`;
    ctx.fill();
  }
  requestAnimationFrame(drawParticles);
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('pointermove', (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});
window.addEventListener('pointerleave', () => {
  pointer.x = null;
  pointer.y = null;
});

resizeCanvas();
drawParticles();
addWelcomeMessage();
