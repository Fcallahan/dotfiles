const CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]+`/g;
const URL = /https?:\/\/[^\s)>\]}]+/g;
const ABSOLUTE_PATH = /(?:^|[\s("'])(\/(?:[^\s/]+\/)*[^\s),;:"']+)/gm;
const NUMBER = /\b\d+(?:[.,:]\d+)*(?:%|ms|s|m|h|KB|MB|GB|K|M)?\b/g;

function matches(pattern: RegExp, text: string): string[] {
	return [...text.matchAll(pattern)].map((match) => match[1] ?? match[0]);
}

export function protectedFragments(text: string): string[] {
	return [
		...matches(CODE_BLOCK, text),
		...matches(INLINE_CODE, text),
		...matches(URL, text).map((value) => value.replace(/[.!?,;:]+$/, "")),
		...matches(ABSOLUTE_PATH, text).map((value) => value.replace(/[.!?]+$/, "")),
		...matches(NUMBER, text),
	].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
}

export function validateRewrite(source: string, rewritten: string): string | undefined {
	if (!rewritten.trim()) return "Editor returned an empty response";

	for (const fragment of protectedFragments(source)) {
		if (!rewritten.includes(fragment)) {
			return `Editor dropped protected content: ${fragment.slice(0, 120)}`;
		}
	}

	return undefined;
}
