import { NextResponse } from "next/server";
import { resetCircuitBreaker, resetAllCircuitBreakers } from "open-sse/utils/circuitBreaker";

export const runtime = "nodejs";

/**
 * POST /api/providers/circuit-breakers/[name]/reset
 * Resets the circuit breaker for a provider (name "all" resets every breaker).
 */
export async function POST(request, { params }) {
  try {
    const { name } = await params;
    const decoded = decodeURIComponent(name || "");
    if (!decoded) {
      return NextResponse.json({ error: "Missing breaker name" }, { status: 400 });
    }
    if (decoded === "all") {
      resetAllCircuitBreakers();
      return NextResponse.json({ ok: true, reset: "all" });
    }
    resetCircuitBreaker(decoded);
    return NextResponse.json({ ok: true, reset: decoded });
  } catch (error) {
    console.error("Failed to reset circuit breaker:", error);
    return NextResponse.json(
      { error: "Failed to reset circuit breaker" },
      { status: 500 }
    );
  }
}
