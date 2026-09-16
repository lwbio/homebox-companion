/**
 * Markdown rendering utility using the unified ecosystem.
 * Supports GFM (tables, task lists, strikethrough) with sanitization.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkRehype)
	.use(rehypeSanitize)
	.use(rehypeStringify);

/**
 * Post-process HTML to add styling to status indicators.
 * Wraps status symbols in spans with appropriate color classes:
 * - ✓ (checkmark) -> success green
 * - ✗ (cross) -> error red
 * - ⊘ (null/rejected) -> warning amber
 */
function styleStatusIndicators(html: string): string {
	return html.replace(/[✓✗⊘]/g, (match) => {
		const colorClass =
			match === '✓' ? 'text-success-500' : match === '✗' ? 'text-error-500' : 'text-warning-500';
		return `<span class="${colorClass} font-semibold">${match}</span>`;
	});
}

/**
 * Render markdown to sanitized HTML.
 * Uses synchronous processing for reactive $derived compatibility.
 */
export function renderMarkdown(md: string): string {
	const html = processor.processSync(md).toString();
	// Add styling to status indicators after sanitization
	return styleStatusIndicators(html);
}
