/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ComponentPropsWithoutRef } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@plane/utils";

export type TAnimatedGridPatternProps = ComponentPropsWithoutRef<"svg"> & {
  /** Width of a single grid cell, in pixels. */
  width?: number;
  /** Height of a single grid cell, in pixels. */
  height?: number;
  /** Horizontal offset of the pattern, in pixels. */
  x?: number;
  /** Vertical offset of the pattern, in pixels. */
  y?: number;
  strokeDasharray?: number;
  /** Number of cells that pulse at any given time. */
  numSquares?: number;
  /** Peak opacity of a pulsing cell. */
  maxOpacity?: number;
  /** Duration of a single fade in/out, in seconds. */
  duration?: number;
  /** Delay before a cell fades back out, in seconds. */
  repeatDelay?: number;
};

type TSquare = {
  id: number;
  pos: [number, number];
  iteration: number;
};

/**
 * Decorative grid backdrop whose cells randomly pulse and then reposition.
 * Purely presentational - it is hidden from assistive tech.
 */
export function AnimatedGridPattern(props: TAnimatedGridPatternProps) {
  const {
    width = 40,
    height = 40,
    x = -1,
    y = -1,
    strokeDasharray = 0,
    numSquares = 50,
    className,
    maxOpacity = 0.5,
    duration = 4,
    repeatDelay = 0.5,
    ...rest
  } = props;
  // refs
  const containerRef = useRef<SVGSVGElement | null>(null);
  // states
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [squares, setSquares] = useState<TSquare[]>([]);
  // derived values
  const id = useId();

  const getPos = useCallback(
    (): [number, number] => [
      Math.floor((Math.random() * dimensions.width) / width),
      Math.floor((Math.random() * dimensions.height) / height),
    ],
    [dimensions.height, dimensions.width, height, width]
  );

  const updateSquarePosition = useCallback(
    (squareId: number) => {
      setSquares((currentSquares) => {
        const current = currentSquares[squareId];
        if (!current || current.id !== squareId) return currentSquares;
        const nextSquares = currentSquares.slice();
        nextSquares[squareId] = { ...current, pos: getPos(), iteration: current.iteration + 1 };
        return nextSquares;
      });
    },
    [getPos]
  );

  useEffect(() => {
    if (!dimensions.width || !dimensions.height) return;
    setSquares(Array.from({ length: numSquares }, (_, index) => ({ id: index, pos: getPos(), iteration: 0 })));
    // `getPos` is intentionally left out - it changes on every resize and would reset the grid mid-animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions.width, dimensions.height, numSquares]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions((currentDimensions) => {
          const nextWidth = entry.contentRect.width;
          const nextHeight = entry.contentRect.height;
          if (currentDimensions.width === nextWidth && currentDimensions.height === nextHeight)
            return currentDimensions;
          return { width: nextWidth, height: nextHeight };
        });
      }
    });
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <svg
      ref={containerRef}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full fill-tertiary/20 stroke-tertiary/20 text-tertiary",
        className
      )}
      {...rest}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <svg x={x} y={y} className="overflow-visible">
        {squares.map(({ pos: [squareX, squareY], id: squareId, iteration }, index) => (
          <motion.rect
            key={`${squareId}-${iteration}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: maxOpacity }}
            transition={{
              duration,
              repeat: 1,
              delay: index * 0.1,
              repeatType: "reverse",
              repeatDelay,
            }}
            onAnimationComplete={() => updateSquarePosition(squareId)}
            width={width - 1}
            height={height - 1}
            x={squareX * width + 1}
            y={squareY * height + 1}
            fill="currentColor"
            strokeWidth="0"
          />
        ))}
      </svg>
    </svg>
  );
}
