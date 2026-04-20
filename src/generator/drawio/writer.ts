import { XMLBuilder } from "fast-xml-parser";

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VertexCell {
  id: string;
  value: string;
  style: string;
  geometry: Geometry;
  parent?: string;
}

export interface EdgeCell {
  id: string;
  source: string;
  target: string;
  value?: string;
  style: string;
  parent?: string;
  waypoints?: Array<{ x: number; y: number }>;
}

export interface DrawioWriterOptions {
  diagramName: string;
}

type CellNode = Record<string, unknown>;

export class DrawioWriter {
  private readonly diagramName: string;
  private readonly cells: CellNode[] = [];

  constructor(options: DrawioWriterOptions) {
    this.diagramName = options.diagramName;
    this.cells.push({ "@_id": "0" });
    this.cells.push({ "@_id": "1", "@_parent": "0" });
  }

  addVertex(cell: VertexCell): this {
    this.cells.push({
      "@_id": cell.id,
      "@_value": cell.value,
      "@_style": cell.style,
      "@_vertex": "1",
      "@_parent": cell.parent ?? "1",
      mxGeometry: {
        "@_x": String(cell.geometry.x),
        "@_y": String(cell.geometry.y),
        "@_width": String(cell.geometry.width),
        "@_height": String(cell.geometry.height),
        "@_as": "geometry",
      },
    });
    return this;
  }

  addEdge(cell: EdgeCell): this {
    const geom: Record<string, unknown> = {
      "@_relative": "1",
      "@_as": "geometry",
    };
    if (cell.waypoints && cell.waypoints.length > 0) {
      geom.Array = {
        "@_as": "points",
        mxPoint: cell.waypoints.map((p) => ({
          "@_x": String(p.x),
          "@_y": String(p.y),
        })),
      };
    }
    this.cells.push({
      "@_id": cell.id,
      ...(cell.value !== undefined ? { "@_value": cell.value } : {}),
      "@_style": cell.style,
      "@_edge": "1",
      "@_parent": cell.parent ?? "1",
      "@_source": cell.source,
      "@_target": cell.target,
      mxGeometry: geom,
    });
    return this;
  }

  serialise(): string {
    const tree = {
      "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
      mxfile: {
        "@_host": "diagram-docs",
        "@_type": "device",
        diagram: {
          "@_name": this.diagramName,
          mxGraphModel: {
            "@_dx": "800",
            "@_dy": "600",
            "@_grid": "1",
            "@_gridSize": "10",
            "@_guides": "1",
            "@_tooltips": "1",
            "@_connect": "1",
            "@_arrows": "1",
            "@_fold": "1",
            "@_page": "1",
            "@_pageScale": "1",
            "@_pageWidth": "850",
            "@_pageHeight": "1100",
            "@_math": "0",
            "@_shadow": "0",
            root: { mxCell: this.cells },
          },
        },
      },
    };
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: true,
      indentBy: "  ",
      suppressEmptyNode: false,
    });
    return builder.build(tree);
  }
}
