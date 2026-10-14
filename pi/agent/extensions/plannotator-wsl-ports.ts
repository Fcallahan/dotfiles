import { release } from "node:os";

export default function () {
	// WSL VirtioProxy can miss localhost forwarding for listeners bound to port 0.
	// Explicit ports keep Plannotator loopback-only and survive package updates.
	if (
		process.platform === "linux" &&
		release().toLowerCase().includes("microsoft") &&
		!process.env.PLANNOTATOR_PORT
	) {
		process.env.PLANNOTATOR_PORT = "19432-19559";
	}
}
