/**
 * Post-processing for D2-rendered SVG files.
 * Injects CSS and JavaScript to make edges clickable with highlight feedback.
 */

const EDGE_STYLE = `
<style type="text/css">
g:has(path.connection) { cursor: pointer; }
.edge-active path.connection {
  stroke: #E8622A !important;
  stroke-width: 3px !important;
}
.edge-active polygon.connection {
  fill: #E8622A !important;
}
.edge-active text {
  fill: #E8622A !important;
}
</style>
`;

// Script is wrapped in CDATA so the SVG remains well-formed XML.
const EDGE_SCRIPT = `
<script type="text/javascript"><![CDATA[
(function () {
  var active = null;

  function deactivate() {
    if (active) {
      active.classList.remove('edge-active');
      active = null;
    }
  }

  document.querySelectorAll('path.connection').forEach(function (path) {
    var g = path.parentNode;
    if (!g || g.tagName.toLowerCase() !== 'g') return;
    g.addEventListener('click', function (e) {
      e.stopPropagation();
      if (active === g) {
        deactivate();
      } else {
        deactivate();
        g.classList.add('edge-active');
        active = g;
      }
    });
  });

  // Click anywhere else to deselect
  document.addEventListener('click', deactivate);
}());
]]></script>
`;

/**
 * Inject click-to-highlight interactivity into a D2-generated SVG string.
 * Returns the SVG unchanged if it contains no edges.
 */
export function addEdgeInteractivity(svg: string): string {
  if (!svg.includes('class="connection')) return svg;

  // Inject immediately before the final </svg> closing tag (outer SVG wrapper).
  return svg.replace(/<\/svg>\s*$/, `${EDGE_STYLE}${EDGE_SCRIPT}</svg>\n`);
}
