"use client";

import {
  Chessboard,
  defaultArrowOptions,
  defaultBoardStyle,
  defaultDarkSquareNotationStyle,
  defaultDarkSquareStyle,
  defaultLightSquareNotationStyle,
  defaultLightSquareStyle,
  defaultSquareStyle,
} from "react-chessboard";
import type { ChessboardOptions, SquareRenderer } from "react-chessboard";
import type { CSSProperties } from "react";

export interface BoardArrow {
  startSquare: string;
  endSquare: string;
  color: string;
}

export interface BoardMark {
  /** Short chess annotation drawn on the square, e.g. "??", "?!", "?". */
  text: string;
  /** Any CSS colour: used as the badge fill. */
  color: string;
}

export default function ChessBoard({
  fen,
  orientation = "white",
  arrows = [],
  squareStyles = {},
  marks = {},
  interactive = false,
  onDrop,
}: {
  fen: string;
  orientation?: "white" | "black";
  arrows?: BoardArrow[];
  squareStyles?: Record<string, CSSProperties>;
  /** Annotation badges keyed by square, e.g. { f4: { text: "?", color: "#f97316" } }. */
  marks?: Record<string, BoardMark>;
  interactive?: boolean;
  onDrop?: (sourceSquare: string, targetSquare: string) => boolean;
}) {
  const markedSquares = Object.keys(marks);

  const options: ChessboardOptions = {
    position: fen,
    boardOrientation: orientation,
    arrows,
    squareStyles,
    // The move played and the engine's choice can share a start square; nudging
    // both starts away from the centre keeps the two arrows readable.
    arrowOptions: { ...defaultArrowOptions, arrowStartOffset: 0.24, opacity: 0.72 },
    showNotation: true,
    allowDragging: interactive,
    allowDrawingArrows: !interactive,
    boardStyle: {
      ...defaultBoardStyle(8),
      // The library sized rows from the board box but columns from 1fr tracks,
      // so a stretched parent produced 36x60 squares. Pin both axes to the box
      // and hold the box at 1:1: every cell is then exactly an eighth of it.
      gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
      gridTemplateRows: "repeat(8, minmax(0, 1fr))",
      aspectRatio: "1 / 1",
      height: "auto",
      minWidth: 0,
      // Paint the board's own square pattern behind the cells: sub-pixel
      // rounding then shows a board colour instead of the black page through
      // the seams.
      backgroundImage: `repeating-conic-gradient(${defaultDarkSquareStyle.backgroundColor} 0% 25%, ${defaultLightSquareStyle.backgroundColor} 0% 50%)`,
      backgroundSize: "25% 25%",
    },
    squareStyle: {
      ...defaultSquareStyle,
      aspectRatio: "auto",
      width: "100%",
      height: "100%",
      minWidth: 0,
      minHeight: 0,
    },
    // Coordinates are text: the library's defaults are 2.29:1 on their own
    // squares. These clear 4.5:1 against both square colours.
    darkSquareNotationStyle: { ...defaultDarkSquareNotationStyle, color: "#241708" },
    lightSquareNotationStyle: { ...defaultLightSquareNotationStyle, color: "#5B4636" },
  };

  if (markedSquares.length > 0) {
    const renderSquare: SquareRenderer = ({ square, children }) => (
      <div style={{ position: "relative", width: "100%", height: "100%", ...squareStyles[square] }}>
        {children}
        {marks[square] ? (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 17,
              height: 17,
              padding: "0 3px",
              borderRadius: 9999,
              background: marks[square].color,
              color: "#0b0b0d",
              fontSize: 11,
              fontWeight: 800,
              lineHeight: 1,
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.55)",
            }}
          >
            {marks[square].text}
          </span>
        ) : null}
      </div>
    );
    options.squareRenderer = renderSquare;
  }

  if (interactive && onDrop) {
    options.onPieceDrop = ({ sourceSquare, targetSquare }) => {
      if (!targetSquare) return false;
      return onDrop(sourceSquare, targetSquare);
    };
  }

  return <Chessboard options={options} />;
}
