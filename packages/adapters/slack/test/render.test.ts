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
            { mention: 'U1' },
            ' a & b < c > d ',
            { link: { text: 't', url: 'https://x' } },
          ],
        },
      ],
    });
    expect(out.blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '<@U1> a &amp; b &lt; c &gt; d <https://x|t>' },
    });
  });

  test('header truncated to 150 chars', () => {
    const out = renderSlack({
      fallbackText: 'fb',
      blocks: [{ type: 'heading', text: 'x'.repeat(200) }],
    });
    const header = out.blocks[0] as { text: { text: string } };
    expect(header.text.text).toHaveLength(150);
  });
});
