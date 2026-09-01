"use client";

import { useState } from "react";
import { Modal, Button, Input } from "@/shared/components";

export default function AutoclawAutomationModal({ isOpen, onClose, onSaved }) {
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleClose() {
    setAccessToken("");
    setRefreshToken("");
    setDeviceId("");
    setError(null);
    onClose?.();
  }

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/autoclaw/import-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          refreshToken: refreshToken.trim(),
          deviceId: deviceId.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }
      setAccessToken("");
      setRefreshToken("");
      setDeviceId("");
      onSaved?.();
      handleClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = Boolean(accessToken.trim() && refreshToken.trim() && !loading);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import AutoClaw Account" size="md">
      <div className="space-y-3">
        {/* Step-by-step instructions */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
          <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 mb-1">How to get your tokens</p>
          <ol className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
            <li>Open <a href="https://autoclaw.z.ai/web/" target="_blank" rel="noopener noreferrer" className="underline">autoclaw.z.ai/web</a> in your browser and log in manually</li>
            <li>Open DevTools (F12) → Console tab</li>
            <li>Paste and run this script:</li>
          </ol>
          <pre className="mt-2 rounded bg-blue-100 dark:bg-blue-950 p-2 text-xs font-mono overflow-x-auto select-all text-blue-900 dark:text-blue-100">{
`(()=>{const k=Object.keys(localStorage);const t={};k.forEach(key=>{const v=localStorage.getItem(key);if(v&&/token|auth|session/i.test(key)&&v.length>10)t[key]=v;});console.log(JSON.stringify(t,null,2));})()`
          }</pre>
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">Copy the <code className="rounded bg-blue-100 dark:bg-blue-900 px-1">autoclaw.web.authToken</code> and <code className="rounded bg-blue-100 dark:bg-blue-900 px-1">autoclaw.web.refreshToken</code> values into the fields below.</p>
        </div>

        <Input
          label="Access Token"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="autoclaw.web.authToken value (Bearer eyJ...)"
          required
        />
        <Input
          label="Refresh Token"
          value={refreshToken}
          onChange={(e) => setRefreshToken(e.target.value)}
          placeholder="autoclaw.web.refreshToken value (Bearer eyJ...)"
          required
        />
        <Input
          label="Device ID (optional)"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="autoclaw.web.deviceId (auto-generated if blank)"
          hint="From autoclaw.web.deviceId in localStorage. Leave blank to auto-generate."
        />
        {error && (
          <p className="text-sm text-red-500 break-words" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" loading={loading} onClick={handleImport} disabled={!canSubmit}>
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
