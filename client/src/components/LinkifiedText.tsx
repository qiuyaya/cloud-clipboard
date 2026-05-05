import React from "react";

const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g;
const TRAILING_PUNCTUATION = /[.,)!?\];:]+$/;

export interface TextSegment {
  type: "text" | "url";
  value: string;
}

export function splitByTextAndUrls(text: string): TextSegment[] {
  if (!text) return [{ type: "text", value: "" }];

  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const matchIndex = match.index!;
    let url = match[0];

    // Strip trailing punctuation from URL
    const stripped = url.replace(TRAILING_PUNCTUATION, "");
    const trailingCount = url.length - stripped.length;
    url = stripped;

    if (matchIndex > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
    }
    segments.push({ type: "url", value: url });

    // Advance lastIndex to the end of the stripped URL.
    // Trailing punctuation (if any) will be picked up as plain text
    // by the next iteration or the final trailing-text check, so it
    // naturally merges with any text that follows.
    lastIndex = matchIndex + url.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

const ALLOWED_HREF_PREFIXES = ["https://", "http://"];

function getHref(url: string): string | null {
  if (url.startsWith("www.")) {
    return `https://${url}`;
  }
  for (const prefix of ALLOWED_HREF_PREFIXES) {
    if (url.startsWith(prefix)) return url;
  }
  return null;
}

export const LinkifiedText = React.memo(function LinkifiedText({ text }: { text: string }) {
  const segments = splitByTextAndUrls(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "url") {
          const href = getHref(segment.value);
          if (href) {
            return (
              <a
                key={index}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 break-all"
              >
                {segment.value}
              </a>
            );
          }
          return <span key={index}>{segment.value}</span>;
        }
        return <span key={index}>{segment.value}</span>;
      })}
    </>
  );
});
