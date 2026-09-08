import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

// marktext #3560: a wide rendered sequence-diagram <svg> overflowed the block
// and was clipped. The fix gives the fixed-size (no-viewBox) <svg> a viewBox
// derived from its width/height so `max-width: 100%` SCALES it to fit (rather
// than just clipping the box). A wide diagram must end up no wider than its
// block — i.e. fully visible, scaled down.
test('a wide sequence diagram scales to fit its block, not clipped (#3560)', async ({ page }) => {
    await page.evaluate(() => {
        // enough actors + deliberately long messages → a diagram far wider than
        // the editor, so the test exercises actual SVG scaling rather than only
        // the ordinary in-range layout.
        const seq = Array.from({ length: 32 }, (_, i) =>
            `Actor${i}->Actor${i + 1}: ${'a reasonably long message '.repeat(6)}${i}`).join('\n');
        window.muya!.setContent([{
            name: 'diagram',
            text: seq,
            meta: { lang: 'yaml', type: 'sequence' },
        }] as Parameters<typeof window.muya.setContent>[0]);
    });

    const svg = page.locator(`${editor.diagramPreview} > svg`).first();
    await expect(svg).toBeVisible({ timeout: 15_000 });

    // the viewBox is added asynchronously (the diagram draws from a font-load
    // callback), so poll for it
    await expect.poll(() => svg.getAttribute('viewBox'), { timeout: 8_000 }).not.toBeNull();

    const fits = await page.evaluate((sel) => {
        const svgEl = document.querySelector(`${sel} > svg`) as SVGSVGElement;
        const block = svgEl.closest('figure.mu-diagram-block') as HTMLElement;
        // The diagram is intrinsically wider than the block, yet renders no
        // wider than the block after SVG scaling.
        const intrinsic = svgEl.viewBox.baseVal.width;
        const rendered = svgEl.getBoundingClientRect().width;
        const blockWidth = block.getBoundingClientRect().width;
        return { wideEnough: intrinsic > blockWidth, fits: rendered <= blockWidth + 1 };
    }, editor.diagramPreview);

    expect(fits.wideEnough).toBe(true);
    expect(fits.fits).toBe(true);
});
