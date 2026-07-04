import satori, { init as initSatori } from "satori/standalone";
import yogaWasmModule from "satori/yoga.wasm";
import { Resvg } from "@cf-wasm/resvg/workerd";
import interRegular from "../assets/fonts/Inter-Regular.ttf";
import interSemiBold from "../assets/fonts/Inter-SemiBold.ttf";
import bigShouldersBold from "../assets/fonts/BigShouldersDisplay-Bold.ttf";
import { layoutFormation, type PlacedPlayer } from "../shared/formation";
import type { Captain, Position, SquadEntry } from "../shared/types";

const PITCH_900 = "#0b2a20";
const PITCH_800 = "#123b2c";
const LINE_CHALK = "#f4f0e4";
const LINE_CHALK_DIM = "#b9c7bd";
const FLOODLIGHT = "#f5a623";
const BEZEL = "#040f0b";
const BEZEL_LINE = "#1c4a32";
const KIT_A = "#3a7bff";
const KIT_B = "#ef4550";

const WIDTH = 1080;
const HEIGHT = 1700;
const MARKER_SIZE = 100;
const PITCH_MARGIN = 24;

const BANNER_HEIGHT = 170;
const SOLO_PLAYABLE_HEIGHT = 900;
const SOLO_HEIGHT = BANNER_HEIGHT + PITCH_MARGIN * 2 + SOLO_PLAYABLE_HEIGHT;
const SOLO_PITCH_TOP = BANNER_HEIGHT + PITCH_MARGIN;
const SOLO_PITCH_BOTTOM = SOLO_HEIGHT - PITCH_MARGIN;

let satoriReady: Promise<void> | undefined;
function ensureSatoriInit(): Promise<void> {
  satoriReady ??= initSatori(yogaWasmModule);
  return satoriReady;
}

function fonts() {
  return [
    { name: "Inter", data: interRegular, weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: interSemiBold, weight: 600 as const, style: "normal" as const },
    { name: "Big Shoulders Display", data: bigShouldersBold, weight: 700 as const, style: "normal" as const },
  ];
}

async function fetchPlayerImageDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function formatPrice(pricePaid: number): string {
  return `£${(pricePaid / 1_000_000).toFixed(1)}m`;
}

function playerMarker(placed: PlacedPlayer, imageDataUri: string | null, kitColor: string, flip: boolean, canvasHeight: number) {
  const { entry, xPct, yPct } = placed;
  const left = xPct * WIDTH - MARKER_SIZE / 2;
  const top = yPct * canvasHeight - MARKER_SIZE / 2;
  const labelOrder = flip ? "column-reverse" : "column";

  return {
    type: "div",
    props: {
      style: {
        position: "absolute",
        left,
        top,
        width: MARKER_SIZE,
        display: "flex",
        flexDirection: labelOrder,
        alignItems: "center",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              width: MARKER_SIZE,
              height: MARKER_SIZE,
              borderRadius: MARKER_SIZE / 2,
              border: `5px solid ${kitColor}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              background: PITCH_800,
              marginTop: flip ? 8 : 0,
              marginBottom: flip ? 0 : 8,
            },
            children: imageDataUri
              ? {
                  type: "img",
                  props: {
                    src: imageDataUri,
                    width: MARKER_SIZE,
                    height: MARKER_SIZE,
                    style: { objectFit: "cover" },
                  },
                }
              : {
                  type: "div",
                  props: {
                    style: {
                      color: LINE_CHALK,
                      fontFamily: "Big Shoulders Display",
                      fontWeight: 700,
                      fontSize: 38,
                    },
                    children: initials(entry.name),
                  },
                },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: MARKER_SIZE + 60,
              whiteSpace: "nowrap",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    color: LINE_CHALK,
                    fontFamily: "Inter",
                    fontWeight: 600,
                    fontSize: 17,
                    textAlign: "center",
                  },
                  children: entry.name,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    color: LINE_CHALK_DIM,
                    fontFamily: "Inter",
                    fontWeight: 400,
                    fontSize: 14,
                  },
                  children: formatPrice(entry.pricePaid),
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function line(style: Record<string, unknown>) {
  return { type: "div", props: { style: { position: "absolute", ...style } } };
}

function penaltyArea(edge: "top" | "bottom", pitchTop: number, pitchBottom: number) {
  const boxWidth = 620;
  const boxDepth = 190;
  const sixYardWidth = 300;
  const sixYardDepth = 66;
  const spotOffset = 130;
  const spotSize = 10;

  const boxTop = edge === "top" ? pitchTop : pitchBottom - boxDepth;
  const sixYardTop = edge === "top" ? pitchTop : pitchBottom - sixYardDepth;
  const spotTop = edge === "top" ? pitchTop + spotOffset : pitchBottom - spotOffset;
  const arcDiameter = 180;
  const arcClipHeight = 56;
  // The "D" is only the sliver of the penalty circle outside the box - clip a full circle down
  // to that sliver with an overflow:hidden container rather than drawing the whole circle
  // (which would otherwise show as a full ring overlapping the goalkeeper's own row).
  const arcClipTop = edge === "top" ? boxTop + boxDepth : boxTop - arcClipHeight;
  const arcOffsetInClip = edge === "top" ? -(arcDiameter - arcClipHeight) : 0;

  const arc = {
    type: "div",
    props: {
      style: {
        position: "absolute",
        left: (WIDTH - arcDiameter) / 2,
        top: arcClipTop,
        width: arcDiameter,
        height: arcClipHeight,
        overflow: "hidden",
        display: "flex",
      },
      children: line({
        left: 0,
        top: arcOffsetInClip,
        width: arcDiameter,
        height: arcDiameter,
        borderRadius: arcDiameter / 2,
        border: `3px solid ${LINE_CHALK_DIM}`,
      }),
    },
  };

  return [
    line({
      left: (WIDTH - boxWidth) / 2,
      top: boxTop,
      width: boxWidth,
      height: boxDepth,
      border: `3px solid ${LINE_CHALK_DIM}`,
      borderTop: edge === "top" ? "none" : `3px solid ${LINE_CHALK_DIM}`,
      borderBottom: edge === "bottom" ? "none" : `3px solid ${LINE_CHALK_DIM}`,
    }),
    line({
      left: (WIDTH - sixYardWidth) / 2,
      top: sixYardTop,
      width: sixYardWidth,
      height: sixYardDepth,
      border: `3px solid ${LINE_CHALK_DIM}`,
      borderTop: edge === "top" ? "none" : `3px solid ${LINE_CHALK_DIM}`,
      borderBottom: edge === "bottom" ? "none" : `3px solid ${LINE_CHALK_DIM}`,
    }),
    line({
      left: WIDTH / 2 - spotSize / 2,
      top: spotTop,
      width: spotSize,
      height: spotSize,
      borderRadius: spotSize / 2,
      background: LINE_CHALK_DIM,
    }),
    arc,
  ];
}

function goalFrame(edge: "top" | "bottom", pitchTop: number, pitchBottom: number) {
  const goalWidth = 160;
  const goalDepth = 16;
  return line({
    left: (WIDTH - goalWidth) / 2,
    top: edge === "top" ? pitchTop - goalDepth : pitchBottom,
    width: goalWidth,
    height: goalDepth,
    border: `3px solid ${LINE_CHALK_DIM}`,
    borderTop: edge === "bottom" ? "none" : `3px solid ${LINE_CHALK_DIM}`,
    borderBottom: edge === "top" ? "none" : `3px solid ${LINE_CHALK_DIM}`,
  });
}

function cornerArc(corner: "tl" | "tr" | "bl" | "br", pitchTop: number, pitchBottom: number) {
  const size = 32;
  const isTop = corner === "tl" || corner === "tr";
  const isLeft = corner === "tl" || corner === "bl";
  const radiusKey =
    corner === "tl" ? "borderTopLeftRadius" : corner === "tr" ? "borderTopRightRadius" : corner === "bl" ? "borderBottomLeftRadius" : "borderBottomRightRadius";

  return line({
    left: isLeft ? PITCH_MARGIN : WIDTH - PITCH_MARGIN - size,
    top: isTop ? pitchTop : pitchBottom - size,
    width: size,
    height: size,
    [radiusKey]: size,
    borderTopColor: isTop ? LINE_CHALK_DIM : "transparent",
    borderBottomColor: isTop ? "transparent" : LINE_CHALK_DIM,
    borderLeftColor: isLeft ? LINE_CHALK_DIM : "transparent",
    borderRightColor: isLeft ? "transparent" : LINE_CHALK_DIM,
    borderStyle: "solid",
    borderWidth: 3,
  });
}

function pitchBackground() {
  const stripeCount = 8;
  const stripeHeight = HEIGHT / stripeCount;
  const stripes = Array.from({ length: stripeCount }, (_, i) => ({
    type: "div",
    props: {
      style: {
        position: "absolute",
        left: 0,
        top: i * stripeHeight,
        width: WIDTH,
        height: stripeHeight,
        background: i % 2 === 0 ? PITCH_900 : PITCH_800,
      },
    },
  }));

  const centerLine = line({
    left: 0,
    top: HEIGHT / 2 - 2,
    width: WIDTH,
    height: 4,
    background: LINE_CHALK_DIM,
  });

  const centerCircle = line({
    left: WIDTH / 2 - 130,
    top: HEIGHT / 2 - 130,
    width: 260,
    height: 260,
    borderRadius: 130,
    border: `3px solid ${LINE_CHALK_DIM}`,
  });

  const centerSpot = line({
    left: WIDTH / 2 - 5,
    top: HEIGHT / 2 - 5,
    width: 10,
    height: 10,
    borderRadius: 5,
    background: LINE_CHALK_DIM,
  });

  const border = line({
    left: PITCH_MARGIN,
    top: PITCH_MARGIN,
    width: WIDTH - PITCH_MARGIN * 2,
    height: HEIGHT - PITCH_MARGIN * 2,
    border: `4px solid ${LINE_CHALK_DIM}`,
  });

  return [
    ...stripes,
    border,
    centerLine,
    centerCircle,
    centerSpot,
    ...penaltyArea("top", PITCH_MARGIN, HEIGHT - PITCH_MARGIN),
    ...penaltyArea("bottom", PITCH_MARGIN, HEIGHT - PITCH_MARGIN),
    goalFrame("top", PITCH_MARGIN, HEIGHT - PITCH_MARGIN),
    goalFrame("bottom", PITCH_MARGIN, HEIGHT - PITCH_MARGIN),
    cornerArc("tl", PITCH_MARGIN, HEIGHT - PITCH_MARGIN),
    cornerArc("tr", PITCH_MARGIN, HEIGHT - PITCH_MARGIN),
    cornerArc("bl", PITCH_MARGIN, HEIGHT - PITCH_MARGIN),
    cornerArc("br", PITCH_MARGIN, HEIGHT - PITCH_MARGIN),
  ];
}

/** A single half-pitch, cropped at the halfway line, for a solo squad's own-half formation. */
function halfPitchBackground() {
  const pitchTop = SOLO_PITCH_TOP;
  const pitchBottom = SOLO_PITCH_BOTTOM;
  const stripeCount = 5;
  const stripeHeight = (pitchBottom - pitchTop) / stripeCount;
  const stripes = Array.from({ length: stripeCount }, (_, i) => ({
    type: "div",
    props: {
      style: {
        position: "absolute",
        left: 0,
        top: pitchTop + i * stripeHeight,
        width: WIDTH,
        height: stripeHeight,
        background: i % 2 === 0 ? PITCH_900 : PITCH_800,
      },
    },
  }));

  const halfwayCircleDiameter = 260;
  const halfwayCircleClipHeight = halfwayCircleDiameter / 2;
  const centerCircleClip = {
    type: "div",
    props: {
      style: {
        position: "absolute",
        left: WIDTH / 2 - halfwayCircleDiameter / 2,
        top: pitchTop,
        width: halfwayCircleDiameter,
        height: halfwayCircleClipHeight,
        overflow: "hidden",
        display: "flex",
      },
      children: line({
        left: 0,
        top: -halfwayCircleClipHeight,
        width: halfwayCircleDiameter,
        height: halfwayCircleDiameter,
        borderRadius: halfwayCircleDiameter / 2,
        border: `3px solid ${LINE_CHALK_DIM}`,
      }),
    },
  };

  const centerSpot = line({
    left: WIDTH / 2 - 5,
    top: pitchTop - 5,
    width: 10,
    height: 10,
    borderRadius: 5,
    background: LINE_CHALK_DIM,
  });

  const border = line({
    left: PITCH_MARGIN,
    top: pitchTop,
    width: WIDTH - PITCH_MARGIN * 2,
    height: pitchBottom - pitchTop,
    border: `4px solid ${LINE_CHALK_DIM}`,
  });

  return [
    ...stripes,
    border,
    centerCircleClip,
    centerSpot,
    ...penaltyArea("bottom", pitchTop, pitchBottom),
    goalFrame("bottom", pitchTop, pitchBottom),
    cornerArc("bl", pitchTop, pitchBottom),
    cornerArc("br", pitchTop, pitchBottom),
  ];
}

function brandBanner(title: string) {
  return {
    type: "div",
    props: {
      style: {
        position: "absolute",
        left: 0,
        top: 0,
        width: WIDTH,
        height: BANNER_HEIGHT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: BEZEL,
        borderBottom: `3px solid ${BEZEL_LINE}`,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              color: FLOODLIGHT,
              fontFamily: "Big Shoulders Display",
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: 6,
            },
            children: "FIVES",
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              color: LINE_CHALK,
              fontFamily: "Big Shoulders Display",
              fontWeight: 700,
              fontSize: 44,
              letterSpacing: 1,
              marginTop: 4,
            },
            children: title,
          },
        },
      ],
    },
  };
}

function header(text: string, topPx: number, withPlate = false) {
  return {
    type: "div",
    props: {
      style: {
        position: "absolute",
        top: topPx,
        left: 0,
        width: WIDTH,
        display: "flex",
        justifyContent: "center",
      },
      children: {
        type: "div",
        props: {
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            ...(withPlate
              ? {
                  background: "rgba(4, 15, 11, 0.88)",
                  padding: "8px 32px 10px",
                  borderRadius: 8,
                  border: `2px solid ${LINE_CHALK_DIM}`,
                }
              : {}),
          },
          children: [
            ...(withPlate
              ? [
                  {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        color: FLOODLIGHT,
                        fontFamily: "Big Shoulders Display",
                        fontWeight: 700,
                        fontSize: 15,
                        letterSpacing: 5,
                      },
                      children: "FIVES",
                    },
                  },
                ]
              : []),
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  color: LINE_CHALK,
                  fontFamily: "Big Shoulders Display",
                  fontWeight: 700,
                  fontSize: 48,
                  letterSpacing: 2,
                },
                children: text,
              },
            },
          ],
        },
      },
    },
  };
}

async function resolveImages(squad: SquadEntry[]): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    squad.map(async (entry) => [entry.playerId, entry.imageUrl ? await fetchPlayerImageDataUri(entry.imageUrl) : null] as const),
  );
  return new Map(entries);
}

// Rows are ordered goal-out for each half, with attackers pulled well clear of the center
// (each row's photo+name+price label extends away from the halfway line, not into the gap)
// so the two formations, plus a center "vs" banner, never overlap.
const COMBINED_ROW_Y_A: Record<Position, number> = { GK: 0.9, DEF: 0.812, MID: 0.724, ATT: 0.635 };
const COMBINED_ROW_Y_B: Record<Position, number> = { GK: 0.1, DEF: 0.188, MID: 0.276, ATT: 0.365 };
const COMBINED_HEADER_TOP = HEIGHT / 2 - 34;

// Fractions of SOLO_HEIGHT (which includes the brand banner), goal-out from the bottom edge.
const SOLO_ROW_Y: Record<Position, number> = {
  GK: (SOLO_PITCH_BOTTOM - 150) / SOLO_HEIGHT,
  DEF: (SOLO_PITCH_BOTTOM - 300) / SOLO_HEIGHT,
  MID: (SOLO_PITCH_BOTTOM - 450) / SOLO_HEIGHT,
  ATT: (SOLO_PITCH_BOTTOM - 620) / SOLO_HEIGHT,
};

async function renderPngFromTree(tree: unknown, canvasHeight: number): Promise<ArrayBuffer> {
  await ensureSatoriInit();
  const svg = await satori(tree as never, { width: WIDTH, height: canvasHeight, fonts: fonts() });
  const resvg = await Resvg.async(svg);
  const png = resvg.render().asPng();
  const copy = new Uint8Array(png.length);
  copy.set(png);
  return copy.buffer;
}

export async function renderSoloSquadPng(squad: SquadEntry[], captain: Captain, captainName: string | null): Promise<ArrayBuffer> {
  const images = await resolveImages(squad);
  const placements = layoutFormation(squad, SOLO_ROW_Y);
  const kitColor = captain === "A" ? KIT_A : KIT_B;

  const tree = {
    type: "div",
    props: {
      style: { position: "relative", width: WIDTH, height: SOLO_HEIGHT, display: "flex" },
      children: [
        ...halfPitchBackground(),
        brandBanner(`${captainName ?? `Captain ${captain}`}'s Squad`),
        ...placements.map((p) => playerMarker(p, images.get(p.entry.playerId) ?? null, kitColor, false, SOLO_HEIGHT)),
      ],
    },
  };

  return renderPngFromTree(tree, SOLO_HEIGHT);
}

export async function renderCombinedSquadPng(
  squadA: SquadEntry[],
  squadB: SquadEntry[],
  captainNames: Record<Captain, string | null>,
): Promise<ArrayBuffer> {
  const [imagesA, imagesB] = await Promise.all([resolveImages(squadA), resolveImages(squadB)]);
  const placementsA = layoutFormation(squadA, COMBINED_ROW_Y_A);
  const placementsB = layoutFormation(squadB, COMBINED_ROW_Y_B);

  const tree = {
    type: "div",
    props: {
      style: { position: "relative", width: WIDTH, height: HEIGHT, display: "flex" },
      children: [
        ...pitchBackground(),
        header(`${captainNames.B ?? "Captain B"}  vs  ${captainNames.A ?? "Captain A"}`, COMBINED_HEADER_TOP, true),
        ...placementsA.map((p) => playerMarker(p, imagesA.get(p.entry.playerId) ?? null, KIT_A, false, HEIGHT)),
        ...placementsB.map((p) => playerMarker(p, imagesB.get(p.entry.playerId) ?? null, KIT_B, true, HEIGHT)),
      ],
    },
  };

  return renderPngFromTree(tree, HEIGHT);
}
