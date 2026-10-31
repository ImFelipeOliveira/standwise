import { describe, expect, test } from 'bun:test';
import { renderSlack } from '../src/render';

describe('renderSlack', () => {
  test('render heading/paragraph/list/divider', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [
        { type: 'heading', text: 'Title' },
        { type: 'paragraph', content: ['hello'] },
        { type: 'list', items: [['a'], ['b']] },
        { type: 'divider' },
      ],
    });
    expect(out.text).toBe('fb');
    expect(out.blocks).toEqual([
      { type: 'header', text: { type: 'plain_text', text: 'Title' } },
      { type: 'section', text: { type: 'mrkdwn', text: 'hello' } },
      { type: 'section', text: { type: 'mrkdwn', text: '• a\n• b' } },
      { type: 'divider' },
    ]);
  });

  test('render inline', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [
        {
          type: 'paragraph',
          content: [
            { mention: 'U123' },
            ' a & b < c > d ',
            { link: { text: 't', url: 'https://x' } },
          ],
        },
      ],
    });
    expect(out.blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '<@U123> a &amp; b &lt; c &gt; d <https://x/|t>' },
    });
  });

  test('a mention with an invalid id renders as escaped text', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [{ type: 'paragraph', content: [{ mention: '<!channel>' }, ' ', { mention: 'u1' }] }],
    });
    const text = (out.blocks[0] as { text: { text: string } }).text.text;
    expect(text).toBe('@&lt;!channel&gt; @u1');
    expect(text).not.toContain('<@');
    expect(text).not.toContain('<!');
  });

  test('header truncated to 150 chars', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [{ type: 'heading', text: 'x'.repeat(200) }],
    });
    const header = out.blocks[0] as { text: { text: string } };
    expect(header.text.text).toHaveLength(150);
  });

  test('link url cannot break out of link syntax', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [
        { type: 'paragraph', content: [{ link: { text: 't', url: 'https://x.com/a|b>c<d e' } }] },
      ],
    });
    const text = (out.blocks[0] as { text: { text: string } }).text.text;
    expect(text).toBe('<https://x.com/a%7Cb%3Ec%3Cd%20e|t>');
  });

  test('non-http link renders as plain text', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [
        {
          type: 'paragraph',
          content: [
            { link: { text: 'a<b', url: 'javascript:alert(1)' } },
            { link: { text: 'bad', url: 'not a url' } },
          ],
        },
      ],
    });
    expect((out.blocks[0] as { text: { text: string } }).text.text).toBe('a&lt;bbad');
  });

  test('raw pings are escaped in blocks and fallback', () => {
    const out = renderSlack({
      fallbackText: '<!channel> hi',
      blocks: [{ type: 'paragraph', content: ['<!channel> hi'] }],
    });
    expect(out.text).toBe('&lt;!channel&gt; hi');
    expect((out.blocks[0] as { text: { text: string } }).text.text).toBe('&lt;!channel&gt; hi');
  });

  test('empty blocks are skipped', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [
        { type: 'paragraph', content: [''] },
        { type: 'list', items: [] },
        { type: 'divider' },
      ],
    });
    expect(out.blocks).toEqual([{ type: 'divider' }]);
  });

  test('section text truncated to 3000 chars', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [{ type: 'paragraph', content: ['y'.repeat(3500)] }],
    });
    const text = (out.blocks[0] as { text: { text: string } }).text.text;
    expect(text).toHaveLength(3000);
    expect(text.endsWith('…')).toBe(true);
  });
});
