<script lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';

  let { content = '' } = $props();

  marked.setOptions({ gfm: true, breaks: true });
  const html = $derived(
    DOMPurify.sanitize(marked.parse(content, { async: false }), {
      USE_PROFILES: { html: true },
    }),
  );
</script>

<div class="quickqa-markdown">{@html html}</div>

<style>
  .quickqa-markdown {
    color: inherit;
    font: inherit;
    line-height: inherit;
    white-space: normal;
    word-break: break-word;
  }

  :global(.quickqa-markdown > :first-child) { margin-top: 0; }
  :global(.quickqa-markdown > :last-child) { margin-bottom: 0; }

  :global(.quickqa-markdown p) { margin: 0.55em 0; }

  :global(.quickqa-markdown h1),
  :global(.quickqa-markdown h2),
  :global(.quickqa-markdown h3),
  :global(.quickqa-markdown h4) {
    margin: 0.9em 0 0.35em;
    font-weight: 680;
    line-height: 1.35;
    letter-spacing: -0.01em;
  }

  :global(.quickqa-markdown h1) { font-size: 1.35em; }
  :global(.quickqa-markdown h2) { font-size: 1.22em; }
  :global(.quickqa-markdown h3) { font-size: 1.1em; }
  :global(.quickqa-markdown h4) { font-size: 1em; }

  :global(.quickqa-markdown ul),
  :global(.quickqa-markdown ol) {
    margin: 0.55em 0;
    padding-left: 1.35em;
    list-style: revert;
  }

  :global(.quickqa-markdown li) { margin: 0.2em 0; }
  :global(.quickqa-markdown li > p) { margin: 0.2em 0; }

  :global(.quickqa-markdown code) {
    padding: 0.12em 0.34em;
    border-radius: 6px;
    background: var(--secondary);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.88em;
  }

  :global(.quickqa-markdown pre) {
    max-width: 100%;
    margin: 0.7em 0;
    padding: 12px 14px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--secondary) 72%, transparent);
    line-height: 1.55;
  }

  :global(.quickqa-markdown pre code) {
    padding: 0;
    background: transparent;
    font-size: 0.86em;
    white-space: pre;
  }

  :global(.quickqa-markdown blockquote) {
    margin: 0.7em 0;
    padding: 0.1em 0 0.1em 12px;
    border-left: 3px solid var(--border);
    color: var(--muted-foreground);
  }

  :global(.quickqa-markdown a) {
    color: var(--brand);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  :global(.quickqa-markdown table) {
    width: 100%;
    margin: 0.7em 0;
    border-collapse: collapse;
    font-size: 0.95em;
  }

  :global(.quickqa-markdown th),
  :global(.quickqa-markdown td) {
    padding: 6px 8px;
    border: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  :global(.quickqa-markdown th) { background: var(--secondary); font-weight: 650; }

  :global(.quickqa-markdown hr) {
    margin: 1em 0;
    border: 0;
    border-top: 1px solid var(--border);
  }

  :global(.quickqa-markdown img) {
    max-width: 100%;
    height: auto;
    border-radius: 10px;
  }
</style>
