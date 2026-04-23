"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: Props) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
