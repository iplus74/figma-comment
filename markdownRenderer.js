// markdownRenderer.js - AI 결과 보고서용 확장 마크다운 렌더러 (emoji, syntax, mathjax, toc, mermaid 코드 보존)
const nodeEmoji = require('node-emoji');
const hljs = require('highlight.js');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

let mathDocument = null;
let mathAdaptor = null;

function getMathJaxConverter() {
  if (!mathDocument) {
    mathAdaptor = liteAdaptor();
    RegisterHTMLHandler(mathAdaptor);
    const tex = new TeX({ packages: AllPackages });
    const svg = new SVG({ fontCache: 'none' });
    mathDocument = mathjax.document('', { InputJax: tex, OutputJax: svg });
  }
  return { mathDocument, mathAdaptor };
}

function escapeHtmlAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderTexToSvg(texSource, display) {
  try {
    const { mathDocument: doc, mathAdaptor: adaptor } = getMathJaxConverter();
    const node = doc.convert(texSource, { display });
    return adaptor.outerHTML(node);
  } catch (err) {
    return `<code>${escapeHtmlAttr(texSource)}</code>`;
  }
}

function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '').trim();
}

function createSlugger() {
  const counts = new Map();
  return function slugify(text) {
    const base =
      String(text || '')
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-') || 'section';
    const prev = counts.get(base) || 0;
    counts.set(base, prev + 1);
    return prev === 0 ? base : `${base}-${prev}`;
  };
}

let cachedDeps = null;
async function loadMarkedDeps() {
  if (!cachedDeps) {
    const [{ Marked }, { markedEmoji }, { markedHighlight }] = await Promise.all([
      import('marked'),
      import('marked-emoji'),
      import('marked-highlight'),
    ]);
    const emojiMap = Object.fromEntries(nodeEmoji.search('').map((e) => [e.name, e.emoji]));
    cachedDeps = { Marked, markedEmoji, markedHighlight, emojiMap };
  }
  return cachedDeps;
}

/**
 * 마크다운 문자열을 HTML과 목차(TOC) 목록으로 변환한다.
 * @param {string} markdownText
 * @returns {Promise<{ html: string, toc: Array<{ level: number, id: string, text: string }> }>}
 */
async function renderMarkdown(markdownText) {
  const { Marked, markedEmoji, markedHighlight, emojiMap } = await loadMarkedDeps();
  const toc = [];
  const slugify = createSlugger();

  const instance = new Marked(
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        const normalizedLang = (lang || '').trim().toLowerCase();
        if (normalizedLang === 'mermaid') {
          return code;
        }
        const language = hljs.getLanguage(normalizedLang) ? normalizedLang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      },
    }),
    markedEmoji({
      emojis: emojiMap,
      renderer: (token) => token.emoji,
    })
  );

  instance.use({
    gfm: true,
    breaks: true,
    renderer: {
      heading(item) {
        const depth = typeof item === 'object' && item !== null ? item.depth : arguments[1];
        const tokens = typeof item === 'object' && item !== null ? item.tokens : null;
        const rawText = typeof item === 'object' && item !== null ? item.text : arguments[0];
        const innerHtml =
          tokens && this.parser && typeof this.parser.parseInline === 'function'
            ? this.parser.parseInline(tokens)
            : rawText || '';
        const plainText = stripHtmlTags(innerHtml) || stripHtmlTags(rawText);
        const id = slugify(plainText);
        if (depth >= 1 && depth <= 4 && plainText) {
          toc.push({ level: depth, id, text: plainText });
        }
        return `<h${depth} id="${escapeHtmlAttr(id)}">${innerHtml}</h${depth}>\n`;
      },
      link(item) {
        const href = typeof item === 'object' && item !== null ? item.href : arguments[0];
        const title = typeof item === 'object' && item !== null ? item.title : arguments[1];
        const tokens = typeof item === 'object' && item !== null ? item.tokens : null;
        const fallbackText = typeof item === 'object' && item !== null ? item.text : arguments[2];
        const text =
          tokens && this.parser && typeof this.parser.parseInline === 'function'
            ? this.parser.parseInline(tokens)
            : fallbackText || '';
        const safeHref = href || '';
        const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : '';
        if (safeHref.startsWith('#')) {
          return `<a href="${escapeHtmlAttr(safeHref)}"${titleAttr}>${text}</a>`;
        }
        return `<a href="${escapeHtmlAttr(safeHref)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
      },
    },
    extensions: [
      {
        name: 'mathBlockDollar',
        level: 'block',
        start(src) {
          return src.indexOf('$$');
        },
        tokenizer(src) {
          const match = /^\$\$\s*\n?([\s\S]+?)\n?\s*\$\$(?:\s*$|\n)/.exec(src);
          if (match) {
            return { type: 'mathBlockDollar', raw: match[0], text: match[1].trim() };
          }
        },
        renderer(token) {
          return `<div class="math-block">${renderTexToSvg(token.text, true)}</div>\n`;
        },
      },
      {
        name: 'mathBlockBracket',
        level: 'block',
        start(src) {
          return src.indexOf('\\[');
        },
        tokenizer(src) {
          const match = /^\\\[\s*\n?([\s\S]+?)\n?\s*\\\](?:\s*$|\n)/.exec(src);
          if (match) {
            return { type: 'mathBlockBracket', raw: match[0], text: match[1].trim() };
          }
        },
        renderer(token) {
          return `<div class="math-block">${renderTexToSvg(token.text, true)}</div>\n`;
        },
      },
      {
        name: 'mathInlineDollar',
        level: 'inline',
        start(src) {
          return src.indexOf('$');
        },
        tokenizer(src) {
          const match = /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/.exec(src);
          if (match) {
            return { type: 'mathInlineDollar', raw: match[0], text: match[1].trim() };
          }
        },
        renderer(token) {
          return `<span class="math-inline">${renderTexToSvg(token.text, false)}</span>`;
        },
      },
      {
        name: 'mathInlineParen',
        level: 'inline',
        start(src) {
          return src.indexOf('\\(');
        },
        tokenizer(src) {
          const match = /^\\\((.+?)\\\)/.exec(src);
          if (match) {
            return { type: 'mathInlineParen', raw: match[0], text: match[1].trim() };
          }
        },
        renderer(token) {
          return `<span class="math-inline">${renderTexToSvg(token.text, false)}</span>`;
        },
      },
    ],
  });

  const html = instance.parse(markdownText || '');
  return { html, toc };
}

module.exports = {
  renderMarkdown,
};
