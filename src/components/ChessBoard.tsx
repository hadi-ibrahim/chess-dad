"use client";

import type { CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import type { ChessboardOptions } from "react-chessboard";

export interface BoardArrow {
  startSquare: string;
  endSquare: string;
  color: string;
}

export default function ChessBoard({
  fen,
  orientation = "white",
  arrows = [],
  squareStyles = {},
  interactive = false,
  onDrop,
}: {
  fen: string;
  orientation?: "white" | "black";
  arrows?: BoardArrow[];
  squareStyles?: Record<string, CSSProperties>;
  interactive?: boolean;
  onDrop?: (sourceSquare: string, targetSquare: string) => boolean;
}) {
  const options: ChessboardOptions = {
    position: fen,
    boardOrientation: orientation,
    arrows,
    squareStyles,
    showNotation: true,
    allowDragging: interactive,
    allowDrawingArrows: !interactive,
  };

  if (interactive && onDrop) {
    options.onPieceDrop = ({ sourceSquare, targetSquare }) => {
      if (!targetSquare) return false;
      return onDrop(sourceSquare, targetSquare);
    };
  }

  return <Chessboard options={options} />;
}
