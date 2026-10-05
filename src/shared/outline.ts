/**
 * Hierarchical Outline Parser & Builder (PRD §20, §49).
 * Parses indented text/bullet outlines into structured Timestripe goal trees.
 * Supports:
 * - Indented lines (spaces or tabs) to represent parent-child depth.
 * - Horizon detection tags: [day], [week], [month], [quarter], [year].
 * - Date calculation from an anchor date based on horizon & day sequence.
 */

import type { TSHorizon } from "./types";

export interface ParsedOutlineNode {
  id: string;
  name: string;
  depth: number;
  horizon: TSHorizon | null;
  dayOffset: number;
  children: ParsedOutlineNode[];
}

const HORIZON_TAG_REGEX = /\[(day|week|month|quarter|year|decade|life)\]/i;

/** Parses a text line to extract indentation depth, clean title, and optional horizon tag. */
export function parseOutlineLine(line: string): { name: string; depth: number; horizon: TSHorizon | null } | null {
  if (!line.trim()) return null;

  // Calculate indentation (2 spaces or 1 tab = 1 depth level)
  const leadingSpaces = line.match(/^[\t ]*/)?.[0] ?? "";
  let depth = 0;
  for (const char of leadingSpaces) {
    if (char === "\t") depth += 1;
    else if (char === " ") depth += 0.5;
  }
  const integerDepth = Math.floor(depth);

  // Clean bullet characters (*, -, •, 1., etc.)
  let content = line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");

  // Extract horizon tag if present
  let horizon: TSHorizon | null = null;
  const tagMatch = content.match(HORIZON_TAG_REGEX);
  if (tagMatch) {
    horizon = tagMatch[1].toLowerCase() as TSHorizon;
    content = content.replace(HORIZON_TAG_REGEX, "").trim();
  }

  return {
    name: content.trim(),
    depth: integerDepth,
    horizon,
  };
}

/** Parses multi-line indented text into a hierarchical tree of OutlineNodes. */
export function parseTextOutline(text: string): ParsedOutlineNode[] {
  const lines = text.split("\n");
  const roots: ParsedOutlineNode[] = [];
  const stack: ParsedOutlineNode[] = [];

  let dayCounter = 0;

  for (const rawLine of lines) {
    const parsed = parseOutlineLine(rawLine);
    if (!parsed) continue;

    const node: ParsedOutlineNode = {
      id: crypto.randomUUID(),
      name: parsed.name,
      depth: parsed.depth,
      horizon: parsed.horizon,
      dayOffset: dayCounter,
      children: [],
    };

    if (parsed.horizon === "day") {
      dayCounter++;
    }

    if (parsed.depth === 0) {
      roots.push(node);
      stack.length = 0;
      stack.push(node);
    } else {
      // Find parent in stack with depth < current depth
      while (stack.length > 0 && stack[stack.length - 1].depth >= parsed.depth) {
        stack.pop();
      }

      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }

      stack.push(node);
    }
  }

  return roots;
}

/** Flatten a parsed outline tree into parent-referenced flat records ready for API creation. */
export interface FlatOutlineItem {
  tempId: string;
  parentTempId: string | null;
  name: string;
  horizon: TSHorizon | null;
  dayOffset: number;
}

export function flattenOutlineTree(nodes: ParsedOutlineNode[], parentTempId: string | null = null): FlatOutlineItem[] {
  const result: FlatOutlineItem[] = [];

  for (const node of nodes) {
    result.push({
      tempId: node.id,
      parentTempId,
      name: node.name,
      horizon: node.horizon,
      dayOffset: node.dayOffset,
    });

    if (node.children.length > 0) {
      result.push(...flattenOutlineTree(node.children, node.id));
    }
  }

  return result;
}
