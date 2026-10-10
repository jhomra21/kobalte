import { cleanup } from "@solidjs/testing-library";
import { afterEach, vi } from "vitest";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});
