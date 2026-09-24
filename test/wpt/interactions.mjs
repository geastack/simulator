// SPDX-License-Identifier: Apache-2.0
// Explicit automation of the instructions in pinned manual reftests. Never
// rewrite selectors or declarations to simulate an interaction's outcome.
export const interactions = {
  'css/css-transforms/css-transform-scale-001-manual.html': [
    { type: 'hover', target: '.greenSquare' },
  ],
};

export function interactionPoint(action, nodes) {
  if (action.type !== 'hover') throw new Error(`Unsupported interaction: ${action.type}`);
  if (action.target === null) return { x: -1, y: -1 };
  if (!/^[.#][a-zA-Z_][\w-]*$/.test(action.target)) throw new Error(`Unsupported interaction target: ${action.target}`);
  const matches = nodes.filter(n => n.attributes.some(([key, value]) =>
    action.target[0] === '#' ? key === 'id' && value === action.target.slice(1)
      : key === 'class' && value.split(/\s+/).includes(action.target.slice(1))));
  if (matches.length !== 1) throw new Error(`Interaction target ${action.target}: expected one node, found ${matches.length}`);
  const [x, y, width, height] = matches[0].box;
  if (width <= 0 || height <= 0) throw new Error(`Interaction target ${action.target} has an empty box`);
  return { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2), nodeId: matches[0].id };
}
