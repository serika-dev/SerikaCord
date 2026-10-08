"use client";
import { useEffect } from "react";
import { GTProvider, useGT } from "gt-next";
import { isChunkLoadError, reloadForNewBuild } from "@/lib/chunkReload";

function GlobalErrorContent({ reset }: { reset: () => void }) {
	const gt = useGT();
	return (
		<div
			style={{
				minHeight: "100dvh",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				textAlign: "center",
				padding: "0 16px",
			}}
		>
			<h1 style={{ fontSize: 24, marginBottom: 8 }}>
				{gt("Something went wrong")}
			</h1>
			<p style={{ color: "#888", fontSize: 14, marginBottom: 24 }}>
				{gt("SerikaCord hit an unexpected error. Reloading usually fixes it.")}
			</p>
			<button
				onClick={reset}
				style={{
					padding: "12px 24px",
					background: "#8B5CF6",
					color: "#fff",
					border: "none",
					borderRadius: 8,
					fontSize: 14,
					fontWeight: 500,
					cursor: "pointer",
				}}
			>
				{gt("Reload")}
			</button>
		</div>
	);
}

export default function GlobalError({
	error,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		// A deploy replaced the chunks this tab was built against: reload.
		if (isChunkLoadError(error) && reloadForNewBuild()) return;
		console.error("Global error:", error);
	}, [error]);
	// reset() re-renders the same broken tree here; a real reload recovers.
	const reload = () => window.location.reload();
	return (
		<html>
			<body
				style={{
					margin: 0,
					background: "#0a0a0a",
					color: "#fff",
					fontFamily: "system-ui, sans-serif",
				}}
			>
				<GTProvider>
					<GlobalErrorContent reset={reload} />
				</GTProvider>
			</body>
		</html>
	);
}
