import { createPointerEvent } from "@kobalte/tests";
import { fireEvent } from "@solidjs/testing-library";
import { render } from "solid-js/web";
import { onTestFinished, vi } from "vitest";

import { DismissableLayer } from "./dismissable-layer";
import { layerStack } from "./layer-stack";

const createTouchEvent = (
	type: string,
	touches: Array<Partial<Touch>>,
	changedTouches: Array<Partial<Touch>>,
) =>
	Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
		touches,
		changedTouches,
	});

describe("DismissableLayer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.clearAllTimers();
	});

	describe("Shadow DOM", () => {
		/**
		 * The shape of #445: a layer and its trigger both rendered inside a shadow root.
		 *
		 * `createInteractOutside` listens on the document, so `event.target` is retargeted to the
		 * shadow host. The host matches neither `excludedElements` nor the layer itself, so both the
		 * trigger and the layer's own content read as "outside" and the layer dismissed itself on
		 * pointerdown — which is what makes a `Select` trigger close and immediately reopen its
		 * dropdown, and what makes clicking an item dismiss the layer before the item can activate.
		 */
		const setupShadowTest = () => {
			const onDismiss = vi.fn();

			const host = document.createElement("div");
			document.body.appendChild(host);
			const shadowRoot = host.attachShadow({ mode: "open" });

			let trigger!: HTMLButtonElement;
			let content!: HTMLSpanElement;
			let outside!: HTMLButtonElement;

			const dispose = render(
				() => (
					<>
						<button ref={trigger} type="button">
							Trigger
						</button>
						<button ref={outside} type="button">
							Outside
						</button>
						<DismissableLayer
							excludedElements={[() => trigger]}
							onDismiss={onDismiss}
						>
							<span ref={content}>Content</span>
						</DismissableLayer>
					</>
				),
				shadowRoot,
			);

			// `createInteractOutside` defers registering its pointerdown listener by a tick.
			vi.runAllTimers();

			onTestFinished(() => {
				dispose();
				host.remove();
			});

			return { onDismiss, trigger, content, outside };
		};

		it("should not dismiss when interacting with an excluded trigger inside a shadow root", () => {
			const { onDismiss, trigger } = setupShadowTest();

			fireEvent(
				trigger,
				createPointerEvent("pointerdown", { bubbles: true, composed: true }),
			);

			expect(onDismiss).not.toHaveBeenCalled();
		});

		it("should not dismiss when interacting with the layer's own content inside a shadow root", () => {
			const { onDismiss, content } = setupShadowTest();

			fireEvent(
				content,
				createPointerEvent("pointerdown", { bubbles: true, composed: true }),
			);

			expect(onDismiss).not.toHaveBeenCalled();
		});

		it("should still dismiss when interacting outside the layer inside a shadow root", () => {
			const { onDismiss, outside } = setupShadowTest();

			fireEvent(
				outside,
				createPointerEvent("pointerdown", { bubbles: true, composed: true }),
			);

			expect(onDismiss).toHaveBeenCalledTimes(1);
		});
	});

	it("dismisses after a completed outside touch without a compatibility click", () => {
		const onDismiss = vi.fn();
		const outside = document.createElement("div");
		document.body.appendChild(outside);

		const dispose = render(
			() => <DismissableLayer onDismiss={onDismiss}>Content</DismissableLayer>,
			document.body,
		);
		vi.runAllTimers();
		onTestFinished(() => {
			dispose();
			outside.remove();
		});

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
			createTouchEvent(
				"touchstart",
				[
					{
						identifier: 1,
						target: outside,
						clientX: 0,
						clientY: 0,
					},
				],
				[
					{
						identifier: 1,
						target: outside,
						clientX: 0,
						clientY: 0,
					},
				],
			),
		);
		fireEvent(
			outside,
			createPointerEvent("pointerup", {
				pointerId: 1,
				pointerType: "touch",
			}),
		);
		fireEvent(
			outside,
			createTouchEvent(
				"touchend",
				[],
				[{ identifier: 1, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		vi.runAllTimers();

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("does not dismiss a touch when a layer opens and closes before completion", () => {
		const onDismiss = vi.fn();
		const outside = document.createElement("div");
		const transientLayer = document.createElement("div");
		document.body.appendChild(outside);
		const dispose = render(
			() => <DismissableLayer onDismiss={onDismiss}>Content</DismissableLayer>,
			document.body,
		);
		vi.runAllTimers();
		onTestFinished(() => {
			dispose();
			outside.remove();
			transientLayer.remove();
		});

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
		document.body.appendChild(transientLayer);
		layerStack.addLayer({ node: transientLayer });
		layerStack.removeLayer(transientLayer);
		fireEvent(
			outside,
			createTouchEvent(
				"touchstart",
				[{ identifier: 2, target: outside, clientX: 0, clientY: 0 }],
				[{ identifier: 2, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		fireEvent(
			outside,
			createPointerEvent("pointerup", {
				pointerId: 2,
				pointerType: "touch",
			}),
		);
		fireEvent(
			outside,
			createTouchEvent(
				"touchend",
				[],
				[{ identifier: 2, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		vi.runAllTimers();

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("preserves outside click activation and event details", () => {
		const onDismiss = vi.fn();
		const onPointerDownOutside = vi.fn();
		const onClick = vi.fn();
		const outside = document.createElement("button");
		outside.addEventListener("click", onClick);
		document.body.appendChild(outside);
		const dispose = render(
			() => (
				<DismissableLayer
					onDismiss={onDismiss}
					onPointerDownOutside={onPointerDownOutside}
				>
					Content
				</DismissableLayer>
			),
			document.body,
		);
		vi.runAllTimers();
		onTestFinished(() => {
			dispose();
			outside.remove();
		});

		const pointerDown = createPointerEvent("pointerdown", {
			pointerId: 3,
			pointerType: "touch",
			isPrimary: true,
			clientX: 0,
			clientY: 0,
		});
		fireEvent(outside, pointerDown);
		fireEvent(
			outside,
			createTouchEvent(
				"touchstart",
				[{ identifier: 3, target: outside, clientX: 0, clientY: 0 }],
				[{ identifier: 3, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		fireEvent(
			outside,
			createPointerEvent("pointerup", {
				pointerId: 3,
				pointerType: "touch",
			}),
		);
		fireEvent(
			outside,
			createTouchEvent(
				"touchend",
				[],
				[{ identifier: 3, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		fireEvent.click(outside);
		vi.runAllTimers();

		expect(onClick).toHaveBeenCalledTimes(1);
		expect(onPointerDownOutside).toHaveBeenCalledTimes(1);
		expect(onPointerDownOutside.mock.calls[0][0].detail.originalEvent).toBe(
			pointerDown,
		);
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("does not dismiss when the native touchend was prevented", () => {
		const onDismiss = vi.fn();
		const outside = document.createElement("div");
		document.body.appendChild(outside);
		const dispose = render(
			() => <DismissableLayer onDismiss={onDismiss}>Content</DismissableLayer>,
			document.body,
		);
		vi.runAllTimers();
		onTestFinished(() => {
			dispose();
			outside.remove();
		});

		fireEvent(
			outside,
			createPointerEvent("pointerdown", {
				pointerId: 4,
				pointerType: "touch",
				isPrimary: true,
				clientX: 0,
				clientY: 0,
			}),
		);
		fireEvent(
			outside,
			createTouchEvent(
				"touchstart",
				[{ identifier: 4, target: outside, clientX: 0, clientY: 0 }],
				[{ identifier: 4, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		fireEvent(
			outside,
			createPointerEvent("pointerup", {
				pointerId: 4,
				pointerType: "touch",
			}),
		);
		const touchEnd = createTouchEvent(
			"touchend",
			[],
			[{ identifier: 4, target: outside, clientX: 0, clientY: 0 }],
		);
		touchEnd.preventDefault();
		fireEvent(outside, touchEnd);
		vi.runAllTimers();

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("keeps the completion window after a quick touch", () => {
		const onDismiss = vi.fn();
		const outside = document.createElement("div");
		document.body.appendChild(outside);
		const dispose = render(
			() => <DismissableLayer onDismiss={onDismiss}>Content</DismissableLayer>,
			document.body,
		);
		vi.runAllTimers();
		onTestFinished(() => {
			dispose();
			outside.remove();
		});

		fireEvent(
			outside,
			createPointerEvent("pointerdown", {
				pointerId: 5,
				pointerType: "touch",
				isPrimary: true,
				clientX: 0,
				clientY: 0,
			}),
		);
		fireEvent(
			outside,
			createTouchEvent(
				"touchstart",
				[{ identifier: 5, target: outside, clientX: 0, clientY: 0 }],
				[{ identifier: 5, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		vi.advanceTimersByTime(150);
		fireEvent(
			outside,
			createPointerEvent("pointerup", {
				pointerId: 5,
				pointerType: "touch",
				clientX: 0,
				clientY: 0,
			}),
		);
		fireEvent(
			outside,
			createTouchEvent(
				"touchend",
				[],
				[{ identifier: 5, target: outside, clientX: 0, clientY: 0 }],
			),
		);

		vi.advanceTimersByTime(399);
		expect(onDismiss).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("matches a compatibility click within the common ancestor", () => {
		const onDismiss = vi.fn();
		const parent = document.createElement("div");
		const downTarget = document.createElement("span");
		downTarget.setAttribute("role", "button");
		const clickTarget = document.createElement("span");
		clickTarget.setAttribute("role", "button");
		parent.append(downTarget, clickTarget);
		document.body.appendChild(parent);
		const originalElementFromPoint = Object.getOwnPropertyDescriptor(
			document,
			"elementFromPoint",
		);
		const elementFromPoint = vi.fn(() => clickTarget);
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: elementFromPoint,
		});
		const dispose = render(
			() => <DismissableLayer onDismiss={onDismiss}>Content</DismissableLayer>,
			document.body,
		);
		onTestFinished(() => {
			dispose();
			Object.defineProperty(
				document,
				"elementFromPoint",
				originalElementFromPoint ?? {
					configurable: true,
					value: undefined,
				},
			);
			parent.remove();
		});
		vi.runAllTimers();

		fireEvent(
			downTarget,
			createPointerEvent("pointerdown", {
				pointerId: 6,
				pointerType: "touch",
				isPrimary: true,
				clientX: 12,
				clientY: 18,
			}),
		);
		fireEvent(
			downTarget,
			createTouchEvent(
				"touchstart",
				[{ identifier: 6, target: downTarget, clientX: 12, clientY: 18 }],
				[{ identifier: 6, target: downTarget, clientX: 12, clientY: 18 }],
			),
		);
		fireEvent(
			clickTarget,
			createPointerEvent("pointerup", {
				pointerId: 6,
				pointerType: "touch",
				clientX: 12,
				clientY: 18,
			}),
		);
		fireEvent(
			clickTarget,
			createTouchEvent(
				"touchend",
				[],
				[{ identifier: 6, target: clickTarget, clientX: 12, clientY: 18 }],
			),
		);
		const click = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			detail: 1,
			clientX: 12,
			clientY: 18,
		});
		click.preventDefault();
		fireEvent(parent, click);
		vi.runAllTimers();

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("retains the pointerup hit when an excluded element moves before completion", () => {
		const onDismiss = vi.fn();
		const outside = document.createElement("div");
		const excluded = document.createElement("div");
		document.body.append(outside, excluded);
		const originalElementFromPoint = Object.getOwnPropertyDescriptor(
			document,
			"elementFromPoint",
		);
		const dispose = render(
			() => (
				<DismissableLayer
					onDismiss={onDismiss}
					excludedElements={[() => excluded]}
				>
					Content
				</DismissableLayer>
			),
			document.body,
		);
		onTestFinished(() => {
			dispose();
			Object.defineProperty(
				document,
				"elementFromPoint",
				originalElementFromPoint ?? {
					configurable: true,
					value: undefined,
				},
			);
			outside.remove();
			excluded.remove();
		});
		vi.runAllTimers();

		fireEvent(
			outside,
			createPointerEvent("pointerdown", {
				pointerId: 7,
				pointerType: "touch",
				isPrimary: true,
				clientX: 0,
				clientY: 0,
			}),
		);
		fireEvent(
			outside,
			createTouchEvent(
				"touchstart",
				[{ identifier: 7, target: outside, clientX: 0, clientY: 0 }],
				[{ identifier: 7, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		const elementFromPoint = vi.fn().mockReturnValue(excluded);
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: elementFromPoint,
		});
		fireEvent(
			outside,
			createPointerEvent("pointerup", {
				pointerId: 7,
				pointerType: "touch",
				clientX: 0,
				clientY: 0,
			}),
		);
		elementFromPoint.mockReturnValue(outside);
		fireEvent(
			outside,
			createTouchEvent(
				"touchend",
				[],
				[{ identifier: 7, target: outside, clientX: 0, clientY: 0 }],
			),
		);
		vi.advanceTimersByTime(400);

		expect(onDismiss).not.toHaveBeenCalled();
	});
});
