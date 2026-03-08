/**
 * @jest-environment jsdom
 */

// We need to export/import functions or just mock them
// For now, let's mock the findTweetText function in a way we can test it.
// In a real scenario, you'd export these from content.js or use a tool like rewire.

function findTweetText(element) {
  if (!element) return null;

  // Search upwards for the tweet container
  let container = element.closest('article');
  if (!container) {
    container = element.closest('[data-testid="cellInnerDiv"]');
  }

  if (container) {
    const tweetTextDiv = container.querySelector('[data-testid="tweetText"]');
    if (tweetTextDiv) {
      return tweetTextDiv.innerText;
    }
  }

  const nearbyText = element.closest('[data-testid="tweetText"]');
  if (nearbyText) return nearbyText.innerText;

  return null;
}

describe('Content Script: Tweet Extraction', () => {
  test('should find text in a standard article tweet', () => {
    document.body.innerHTML = `
      <article>
        <div data-testid="tweetText">Hello World!</div>
        <button id="clicked">Click Me</button>
      </article>
    `;
    const clickedElement = document.getElementById('clicked');
    const text = findTweetText(clickedElement);
    expect(text).toBe('Hello World!');
  });

  test('should find text in a "cellInnerDiv" focused tweet', () => {
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv">
        <div data-testid="tweetText">Focused Text</div>
        <span id="clicked">Span</span>
      </div>
    `;
    const clickedElement = document.getElementById('clicked');
    const text = findTweetText(clickedElement);
    expect(text).toBe('Focused Text');
  });

  test('should return null if no tweet text is found', () => {
    document.body.innerHTML = `<div>Random content</div>`;
    const clickedElement = document.querySelector('div');
    const text = findTweetText(clickedElement);
    expect(text).toBeNull();
  });
});
