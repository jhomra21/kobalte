import { createPointerEvent, installPointerEvent } from "@kobalte/tests";
import { fireEvent, render } from "@solidjs/testing-library";
import { vi } from "vitest";

import { DismissableLayer } from "./dismissable-layer";
import { layerStack } from "./layer-stack";

describe("DismissableLayer", () => {
	installPointerEvent();

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("dismisses after an outside touch without a compatibility click", () => {
		const onDismiss = vi.fn();
		const outside = document.createElement("div");
		document.body.appendChild(outside);
		vi.stubGlobal("elementFromPoint", undefined);
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: () => outside,
		});
		const result = render(() => (
			<DismissableLayer onDismiss={onDismiss}>Content</DismissableLayer>
		));
		vi.runOnlyPendingTimers();

		fireEvent(
			outside,
			createPointerEvent("pointerdown", {
				pointerId: 1,
				pointerType: "touch",
				isPrimary: true,
				clientX: 0,
				clientY: 0,
			}),
		);
		fireEvent(
			outside,
			createPointerEvent("pointerup", {
				pointerId: 1,
				pointerType: "touch",
				clientX: 0,
				clientY: 0,
			}),
		);
		vi.advanceTimersByTime(401);

		expect(onDismiss).toHaveBeenCalledTimes(1);

		result.unmount();
		outside.remove();
		vi.unstubAllGlobals();
	});

	it("ignores a touch when the layer stack changes before completion", () => {
		const onDismiss = vi.fn();
		const outside = document.createElement("div");
		document.body.appendChild(outside);
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: () => outside,
		});
		const result = render(() => (
			<DismissableLayer onDismiss={onDismiss}>Content</DismissableLayer>
		));
		vi.runOnlyPendingTimers();

		fireEvent(
			outside,
			createPointerEvent("pointerdown", {
				pointerId: 2,
				pointerType: "touch",
				isPrimary: true,
				clientX: 0,
				clientY: 0,
			}),
		);
		const transientLayer = document.createElement("div");
		layerStack.addLayer({ node: transientLayer });
		layerStack.removeLayer(transientLayer);
		fireEvent(
			outside,
			createPointerEvent("pointerup", {
				pointerId: 2,
				pointerType: "touch",
				clientX: 0,
				clientY: 0,
			}),
		);
		vi.advanceTimersByTime(401);

		expect(onDismiss).not.toHaveBeenCalled();

		result.unmount();
		outside.remove();
		vi.unstubAllGlobals();
	});
});
