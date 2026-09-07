import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, name, allowedProviders, allowedCombos, allowedKinds } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (name !== undefined) updateData.name = name;
    // ACL allow-lists — tri-state: null=all, []=none, [ids...]=whitelist.
    // Only applied when the field is explicitly present (absence keeps value).
    if ("allowedProviders" in body) {
      if (allowedProviders !== null && !Array.isArray(allowedProviders)) {
        return NextResponse.json({ error: "allowedProviders must be null or an array of provider ids/aliases" }, { status: 400 });
      }
      updateData.allowedProviders = allowedProviders;
    }
    if ("allowedCombos" in body) {
      if (allowedCombos !== null && !Array.isArray(allowedCombos)) {
        return NextResponse.json({ error: "allowedCombos must be null or an array of combo names" }, { status: 400 });
      }
      updateData.allowedCombos = allowedCombos;
    }
    if ("allowedKinds" in body) {
      if (allowedKinds !== null && !Array.isArray(allowedKinds)) {
        return NextResponse.json({ error: "allowedKinds must be null or an array of kinds (llm, embedding, image, tts, stt, web)" }, { status: 400 });
      }
      updateData.allowedKinds = allowedKinds;
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
