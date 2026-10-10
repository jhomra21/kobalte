/*
 * Portions of this file are based on code from radix-ui-primitives.
 * MIT Licensed, Copyright (c) 2022 WorkOS.
 *
 * Credits to the Radix UI team:
 * https://github.com/radix-ui/primitives/blob/81b25f4b40c54f72aeb106ca0e64e1e09655153e/packages/react/dismissable-layer/src/DismissableLayer.tsx
 *
 * Portions of this file are based on code from zag.
 * MIT Licensed, Copyright (c) 2021 Chakra UI.
 *
 * Credits to the Chakra UI team:
 * https://github.com/chakra-ui/zag/blob/d1dbf9e240803c9e3ed81ebef363739be4273de0/packages/utilities/interact-outside/src/index.ts
 */

import {
	type MaybeAccessor,
	access,
	composeEventHandlers,
	getDocument,
	isCtrlKey,
} from "@kobalte/utils";
import { type Accessor, createEffect, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";

import { DATA_TOP_LAYER_ATTR } from "../../dismissable-layer/layer-stack";
import { closestComposed, containsComposed, getEventTarget } from "./utils";

type EventDetails<T> = {
	originalEvent: T;
	isContextMenu: boolean;
};

export type PointerDownOutsideEvent = CustomEvent<EventDetails<PointerEvent>>;
export type FocusOutsideEvent = CustomEvent<EventDetails<FocusEvent>>;
export type InteractOutsideEvent = PointerDownOutsideEvent | FocusOutsideEvent;

export interface CreateInteractOutsideProps {
	/** Whether the interact outside events should be listened or not. */
	isDisabled?: MaybeAccessor<boolean | undefined>;

	/**
	 * When user interacts with the argument element outside the ref,
	 * return `true` if the interaction should not trigger the "interact outside" handlers.
	 */
	shouldExcludeElement?: (element: Element) => boolean;

	/**
	 * Event handler called when a `pointerdown` event happens outside the ref.
	 * Can be prevented.
	 */
	onPointerDownOutside?: (event: PointerDownOutsideEvent) => void;

	/**
	 * Event handler called when the focus moves outside the ref.
	 * Can be prevented.
	 */
	onFocusOutside?: (event: FocusOutsideEvent) => void;

	/**
	 * Event handler called when an interaction happens outside the ref.
	 * Specifically, when a `pointerdown` event happens outside or focus moves outside of it.
	 * Can be prevented.
	 */
	onInteractOutside?: (event: InteractOutsideEvent) => void;

	/** Capture whether a touch is eligible and return a guard for its completion. */
	captureTouchOutside?: () => (() => boolean) | undefined;
}

const POINTER_DOWN_OUTSIDE_EVENT = "interactOutside.pointerDownOutside";
const FOCUS_OUTSIDE_EVENT = "interactOutside.focusOutside";

export function createInteractOutside<T extends Element>(
	props: CreateInteractOutsideProps,
	ref: Accessor<T | undefined>,
) {
	let pointerDownTimeoutId: number | undefined;
	let touchCleanup: VoidFunction | undefined;

	const ownerDocument = () => getDocument(ref());
	const onPointerDownOutside = (e: PointerDownOutsideEvent) =>
		props.onPointerDownOutside?.(e);
	const onFocusOutside = (e: FocusOutsideEvent) => props.onFocusOutside?.(e);
	const onInteractOutside = (e: InteractOutsideEvent) =>
		props.onInteractOutside?.(e);
	const onLateTouchClick = (event: Event) => {
		const click = event as MouseEvent;
		if (!click.detail) {
			return;
		}
		const target = getEventTarget(click);
		const hit = ownerDocument().elementFromPoint?.(
			click.clientX,
			click.clientY,
		);
		const ElementConstructor = ownerDocument().defaultView?.Element;
		if (
			!target ||
			!hit ||
			!ElementConstructor ||
			!(target instanceof ElementConstructor)
		) {
			return;
		}
		const original = lateTouchOriginalTarget;
		if (original?.contains(hit) || lateTouchCompletionTarget?.contains(hit)) {
			removeLateTouchClickProtection();
			return;
		}
		if (
			Math.hypot(click.clientX - lateTouchX, click.clientY - lateTouchY) > 10
		) {
			removeLateTouchClickProtection();
			return;
		}
		if (target.contains(hit)) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		removeLateTouchClickProtection();
	};
	let lateTouchOriginalTarget: Element | undefined;
	let lateTouchCompletionTarget: Element | undefined;
	let lateTouchX = 0;
	let lateTouchY = 0;
	let lateTouchClickTimeout: number | undefined;
	const removeLateTouchClickProtection = () => {
		const doc = ownerDocument();
		doc.removeEventListener("click", onLateTouchClick, true);
		doc.removeEventListener(
			"pointerdown",
			removeLateTouchClickProtection,
			true,
		);
		if (lateTouchClickTimeout !== undefined) {
			window.clearTimeout(lateTouchClickTimeout);
			lateTouchClickTimeout = undefined;
		}
		lateTouchOriginalTarget = undefined;
		lateTouchCompletionTarget = undefined;
		lateTouchX = 0;
		lateTouchY = 0;
	};

	const isEventOutside = (e: Event | { target: EventTarget | null }) => {
		// The element the interaction started on, not `e.target` — these listeners
		// are on the document, so an interaction inside a shadow tree reports that
		// tree's host instead. The distinction decides this function: a layer
		// rendered inside a shadow root sees each of its own clicks as the host,
		// which is outside itself, and dismisses on pointerdown.
		const target =
			"composedPath" in e && typeof e.composedPath === "function"
				? getEventTarget(e as Event)
				: e.target instanceof Element
					? e.target
					: null;

		if (!target) {
			return false;
		}

		// If the target is within a top layer element (e.g. toasts), ignore.
		if (closestComposed(target, `[${DATA_TOP_LAYER_ATTR}]`)) {
			return false;
		}

		if (!containsComposed(ownerDocument(), target)) {
			return false;
		}

		if (containsComposed(ref(), target)) {
			return false;
		}

		return !props.shouldExcludeElement?.(target);
	};

	const onPointerDown = (e: PointerEvent) => {
		removeLateTouchClickProtection();
		const handler = () => {
			const container = ref();
			const target = getEventTarget(e);

			if (!container || !target || !isEventOutside(e)) {
				return false;
			}

			const handler = composeEventHandlers([
				onPointerDownOutside,
				onInteractOutside,
			]) as EventListener;

			target.addEventListener(POINTER_DOWN_OUTSIDE_EVENT, handler, {
				once: true,
			});

			const pointerDownOutsideEvent = new CustomEvent(
				POINTER_DOWN_OUTSIDE_EVENT,
				{
					bubbles: false,
					cancelable: true,
					detail: {
						originalEvent: e,
						isContextMenu: e.button === 2 || (isCtrlKey(e) && e.button === 0),
					} as EventDetails<PointerEvent>,
				},
			);

			target.dispatchEvent(pointerDownOutsideEvent);
			return !pointerDownOutsideEvent.defaultPrevented;
		};

		// Mouse interactions are immediate. Touch interactions are dispatched
		// after their native completion events settle, including when no click is
		// generated.
		if (e.pointerType !== "touch") {
			touchCleanup?.();
			touchCleanup = undefined;
			handler();
			return;
		}

		touchCleanup?.();
		touchCleanup = undefined;
		const doc = ownerDocument();
		if (!e.isPrimary) {
			return;
		}
		const startedAt = performance.now();
		const eligible = props.captureTouchOutside?.() ?? (() => true);
		let upEvent: PointerEvent | undefined;
		let touchStartEvent: TouchEvent | undefined;
		let touchEndEvent: TouchEvent | undefined;
		let compatibilityClick: MouseEvent | undefined;
		let touchId: number | undefined;
		let completionTimer: number | undefined;
		let watchdogTimer: number | undefined;
		let upTarget: EventTarget | null = null;
		const clean = () => {
			doc.removeEventListener("pointerup", onPointerUp, true);
			doc.removeEventListener("pointercancel", onPointerCancel, true);
			doc.removeEventListener("touchstart", onTouchStart, true);
			doc.removeEventListener("touchmove", onTouchMove, true);
			doc.removeEventListener("touchend", onTouchEnd, true);
			doc.removeEventListener("touchcancel", onCancel, true);
			doc.removeEventListener("scroll", onCancel, true);
			doc.removeEventListener("pointermove", onPointerMove, true);
			doc.removeEventListener("click", onClick, true);
			if (completionTimer !== undefined) {
				window.clearTimeout(completionTimer);
			}
			if (watchdogTimer !== undefined) {
				window.clearTimeout(watchdogTimer);
			}
			if (touchCleanup === clean) {
				touchCleanup = undefined;
			}
		};
		const onCancel = () => clean();
		const onPointerCancel = (event: Event) => {
			if ((event as PointerEvent).pointerId === e.pointerId) {
				clean();
			}
		};
		const moved = (event: Pick<PointerEvent, "clientX" | "clientY">) =>
			Math.hypot(event.clientX - e.clientX, event.clientY - e.clientY) > 10;
		const onPointerMove = (event: Event) => {
			const pointer = event as PointerEvent;
			if (pointer.pointerId === e.pointerId && moved(pointer)) {
				clean();
			}
		};
		const onPointerUp = (event: Event) => {
			const pointer = event as PointerEvent;
			if (pointer.pointerId !== e.pointerId) {
				return;
			}
			if (moved(pointer) || performance.now() - startedAt >= 500) {
				clean();
				return;
			}
			upEvent = pointer;
			upTarget =
				doc.elementFromPoint?.(pointer.clientX, pointer.clientY) ??
				getEventTarget(pointer);
			if (watchdogTimer !== undefined) {
				window.clearTimeout(watchdogTimer);
				watchdogTimer = undefined;
			}
			if (!touchStartEvent) {
				completionTimer = window.setTimeout(finish, 400);
			} else {
				watchdogTimer = window.setTimeout(clean, 400);
			}
		};
		const onTouchStart = (event: Event) => {
			const touch = event as TouchEvent;
			const point = touch.changedTouches[0];
			const target = getEventTarget(e);
			if (
				touchStartEvent ||
				touch.touches.length !== 1 ||
				!point ||
				point.target !== target
			) {
				clean();
				return;
			}
			if (completionTimer !== undefined) {
				window.clearTimeout(completionTimer);
				completionTimer = undefined;
			}
			touchStartEvent = touch;
			touchId = point.identifier;
		};
		const onTouchMove = (event: Event) => {
			const touch = event as TouchEvent;
			const point = [...touch.touches].find(
				(item) => item.identifier === touchId,
			);
			if (touch.touches.length !== 1 || !point || moved(point)) {
				clean();
			}
		};
		const finish = () => {
			const currentHit =
				upEvent &&
				(doc.elementFromPoint?.(upEvent.clientX, upEvent.clientY) ??
					getEventTarget(upEvent));
			if (
				!upEvent ||
				!eligible() ||
				e.defaultPrevented ||
				upEvent.defaultPrevented ||
				touchStartEvent?.defaultPrevented ||
				touchEndEvent?.defaultPrevented ||
				compatibilityClick?.defaultPrevented ||
				!upTarget ||
				!isEventOutside(e) ||
				!isEventOutside({ target: upTarget }) ||
				!currentHit ||
				!isEventOutside({ target: currentHit })
			) {
				clean();
				return;
			}
			const ElementConstructor = doc.defaultView?.Element;
			const downTarget = getEventTarget(e);
			const original =
				ElementConstructor && downTarget instanceof ElementConstructor
					? downTarget.closest(
							"button, a[href], input, select, textarea, label",
						) ?? downTarget
					: undefined;
			clean();
			const accepted = handler();
			if (
				accepted !== false &&
				ElementConstructor &&
				original instanceof ElementConstructor &&
				upTarget instanceof ElementConstructor
			) {
				lateTouchOriginalTarget = original;
				lateTouchCompletionTarget = upTarget;
				lateTouchX = upEvent.clientX;
				lateTouchY = upEvent.clientY;
				doc.addEventListener("click", onLateTouchClick, true);
				doc.addEventListener(
					"pointerdown",
					removeLateTouchClickProtection,
					true,
				);
				lateTouchClickTimeout = window.setTimeout(
					removeLateTouchClickProtection,
					400,
				);
			}
		};
		const onTouchEnd = (event: Event) => {
			touchEndEvent = event as TouchEvent;
			const point = [...touchEndEvent.changedTouches].find(
				(item) => item.identifier === touchId,
			);
			if (
				touchEndEvent.defaultPrevented ||
				(touchStartEvent && !point) ||
				touchEndEvent.touches.length > 0 ||
				(point ? moved(point) : false)
			) {
				clean();
				return;
			}
			if (!upEvent) {
				return;
			}
			if (watchdogTimer !== undefined) {
				window.clearTimeout(watchdogTimer);
				watchdogTimer = undefined;
			}
			completionTimer = window.setTimeout(finish, compatibilityClick ? 0 : 400);
		};
		const onClick = (event: Event) => {
			const click = event as MouseEvent;
			const target = getEventTarget(click);
			const downTarget = getEventTarget(e);
			const ElementConstructor = doc.defaultView?.Element;
			const currentHit =
				upEvent &&
				(doc.elementFromPoint?.(upEvent.clientX, upEvent.clientY) ??
					getEventTarget(upEvent));
			if (
				!click.detail ||
				!upEvent ||
				!ElementConstructor ||
				!(target instanceof ElementConstructor) ||
				!(downTarget instanceof ElementConstructor) ||
				!upTarget ||
				!(upTarget instanceof ElementConstructor) ||
				!currentHit ||
				!(currentHit instanceof ElementConstructor) ||
				!isEventOutside(click)
			) {
				return;
			}
			const original =
				downTarget.closest("button, a[href], input, select, textarea, label") ??
				downTarget;
			const commonAncestor = (() => {
				for (
					let ancestor: Element | null = downTarget;
					ancestor;
					ancestor = ancestor.parentElement
				) {
					if (
						ancestor !== doc.body &&
						ancestor !== doc.documentElement &&
						ancestor.contains(upTarget) &&
						ancestor.contains(target)
					) {
						return ancestor;
					}
				}
				return null;
			})();
			if (
				(!original.contains(target) && !commonAncestor) ||
				(!target.contains(currentHit) && !currentHit.contains(target))
			) {
				return;
			}
			compatibilityClick = click;
			if (touchEndEvent) {
				if (completionTimer !== undefined) {
					window.clearTimeout(completionTimer);
				}
				completionTimer = window.setTimeout(finish, 0);
			}
		};
		doc.addEventListener("pointerup", onPointerUp, true);
		doc.addEventListener("pointercancel", onPointerCancel, true);
		doc.addEventListener("touchstart", onTouchStart, true);
		doc.addEventListener("touchmove", onTouchMove, true);
		doc.addEventListener("touchend", onTouchEnd, true);
		doc.addEventListener("touchcancel", onCancel, true);
		doc.addEventListener("scroll", onCancel, true);
		doc.addEventListener("pointermove", onPointerMove, true);
		doc.addEventListener("click", onClick, true);
		watchdogTimer = window.setTimeout(() => {
			if (!upEvent) {
				clean();
			}
		}, 500);
		touchCleanup = clean;
	};

	const onFocusIn = (e: FocusEvent) => {
		const container = ref();
		const target = getEventTarget(e);

		if (!container || !target || !isEventOutside(e)) {
			return;
		}

		const handler = composeEventHandlers([
			onFocusOutside,
			onInteractOutside,
		]) as EventListener;

		target.addEventListener(FOCUS_OUTSIDE_EVENT, handler, { once: true });

		const focusOutsideEvent = new CustomEvent(FOCUS_OUTSIDE_EVENT, {
			bubbles: false,
			cancelable: true,
			detail: {
				originalEvent: e,
				isContextMenu: false,
			} as EventDetails<FocusEvent>,
		});

		target.dispatchEvent(focusOutsideEvent);
	};

	createEffect(() => {
		if (isServer) {
			return;
		}

		if (access(props.isDisabled)) {
			return;
		}

		/**
		 * if this primitive executes in a component that mounts via a `pointerdown` event, the event
		 * would bubble up to the document and trigger a `pointerDownOutside` event. We avoid
		 * this by delaying the event listener registration on the document.
		 * ```
		 * button.addEventListener('pointerdown', () => {
		 *   console.log('I will log');
		 *   document.addEventListener('pointerdown', () => {
		 *     console.log('I will also log');
		 *   })
		 * });
		 */
		pointerDownTimeoutId = window.setTimeout(() => {
			ownerDocument().addEventListener("pointerdown", onPointerDown, true);
		}, 0);

		ownerDocument().addEventListener("focusin", onFocusIn, true);

		onCleanup(() => {
			window.clearTimeout(pointerDownTimeoutId);

			touchCleanup?.();
			touchCleanup = undefined;
			removeLateTouchClickProtection();
			ownerDocument().removeEventListener("pointerdown", onPointerDown, true);
			ownerDocument().removeEventListener("focusin", onFocusIn, true);
		});
	});
}
