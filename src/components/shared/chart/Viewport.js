/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import * as React from 'react';
import classNames from 'classnames';
import explicitConnect from 'firefox-profiler/utils/connect';
import {
  getHasZoomedViaMousewheel,
  getPanelLayoutGeneration,
} from 'firefox-profiler/selectors/app';
import { setHasZoomedViaMousewheel } from 'firefox-profiler/actions/app';
import { updatePreviewSelection } from 'firefox-profiler/actions/profile-view';

import type {
  CssPixels,
  UnitIntervalOfProfileRange,
  StartEndRange,
  PreviewSelection,
} from 'firefox-profiler/types';

import type { ConnectedProps } from 'firefox-profiler/utils/connect';
import {
  getObjectValuesAsUnion,
  assertExhaustiveCheck,
} from 'firefox-profiler/utils/flow';

/**
 * Viewport terminology:
 *                                                  (this time is relative to current
 *                                                   profile range, not the total profile)
 *                 <------ e.g. 1000px ------>         0.7 - Sample's unit time
 *                 ___________________________          |
 *         _______|___________________________|_________|______________________
 *        |       |                           |         v                      |
 * |<-------------|---------------------------|---------*------- Total profile samples ------>|
 *        |       |                           |                                |
 *        |       |      Screen Viewport      |                                |
 *        |       |                           |         Current profile range  |
 *        |_______|___________________________|________________________________|
 *                |___________________________|
 *        ^       ^                           ^                                ^
 *        0.0    0.1                          0.6                              1.0
 *                 ^ viewportLeft               ^ viewportRight
 *
 * viewportLeft = 0.1
 * viewportRight = 0.6
 * viewportLength = viewportRight - viewportLeft
 * viewportTop = 30 (in pixels)
 * screenWidth = 1000
 * unitPixel = viewportLength / screenWidth
 * viewportRight += mouseMoveDelta * unitPixel
 * viewportLeft += mouseMoveDelta * unitPixel
 **/

const { DOM_DELTA_PAGE, DOM_DELTA_LINE } =
  typeof window === 'object' && window.WheelEvent
    ? new WheelEvent('mouse')
    : { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 };

/**
 * How fast the viewport should move when navigating with the keyboard
 * in pixels per second.
 */
const KEYBOARD_NAVIGATION_SPEED = 2000;
const MAX_KEYBOARD_DELTA = 500;

type NavigationKey = 'zoomIn' | 'zoomOut' | 'up' | 'down' | 'left' | 'right';

/**
 * Mapping from keycode to navigation key when no modifiers are down.
 */
const BARE_KEYMAP: { [string]: NavigationKey } = {
  KeyQ: 'zoomIn',
  KeyY: 'zoomIn',
  KeyE: 'zoomOut',
  KeyU: 'zoomOut',
  KeyW: 'up',
  KeyK: 'up',
  KeyS: 'down',
  KeyJ: 'down',
  KeyA: 'left',
  KeyH: 'left',
  KeyD: 'right',
  KeyL: 'right',
};
/**
 * Mapping from keycode to navigation key when the ctrl modifier is down.
 */
const CTRL_KEYMAP: { [string]: NavigationKey } = {
  ArrowUp: 'zoomIn',
  ArrowDown: 'zoomOut',
};

// These viewport values (most of which are computed dynamically by
// the HOC) are passed into the props of the wrapped component.
export type Viewport = {|
  +containerWidth: CssPixels,
  +containerHeight: CssPixels,
  +viewportLeft: UnitIntervalOfProfileRange,
  +viewportRight: UnitIntervalOfProfileRange,
  +viewportTop: CssPixels,
  +viewportBottom: CssPixels,
  +isDragging: boolean,
  +moveViewport: (CssPixels, CssPixels) => void,
  +isSizeSet: boolean,
|};

type ViewportStateProps = {|
  +panelLayoutGeneration: number,
  +hasZoomedViaMousewheel?: boolean,
|};

type ViewportDispatchProps = {|
  +updatePreviewSelection: typeof updatePreviewSelection,
  +setHasZoomedViaMousewheel?: typeof setHasZoomedViaMousewheel,
|};

// These are the props consumed by this Higher-Order Component (HOC), but can be
// optionally used by the wrapped component.
type ViewportOwnProps<ChartProps> = {|
  +viewportProps: {|
    +timeRange: StartEndRange,
    +maxViewportHeight: number,
    +startsAtBottom?: boolean,
    +maximumZoom: UnitIntervalOfProfileRange,
    +previewSelection: PreviewSelection,
    +disableHorizontalMovement?: boolean,
    +className?: string,
    +marginLeft: CssPixels,
    +marginRight: CssPixels,
    +containerRef?: (HTMLDivElement | null) => void,
    // These props are defined by the generic variables passed into to the type
    // WithChartViewport when calling withChartViewport. This is how the relationship
    // is guaranteed. e.g. here with OwnProps:
    //
    //   (withChartViewport: WithChartViewport<OwnProps, Props>)(
    //     MarkerChartCanvas
    //   )
    +viewportNeedsUpdate: (
      prevProps: ChartProps,
      nextProps: ChartProps
    ) => boolean,
  |},
  +chartProps: ChartProps,
|};

type HorizontalViewport = {|
  viewportLeft: UnitIntervalOfProfileRange,
  viewportRight: UnitIntervalOfProfileRange,
|};

type State = {|
  containerWidth: CssPixels,
  containerHeight: CssPixels,
  containerLeft: CssPixels,
  viewportTop: CssPixels,
  viewportBottom: CssPixels,
  horizontalViewport: HorizontalViewport,
  dragX: CssPixels,
  dragY: CssPixels,
  isDragging: boolean,
  isScrollHintVisible: boolean,
  isSizeSet: boolean,
|};

import './Viewport.css';

// The overall zoom speed for shift and pinch zooming.
const ZOOM_SPEED = 1.003;
// This value makes the pinch zooming faster than shift+scroll zooming.
const PINCH_ZOOM_FACTOR = 3;

/**
 * This is the type signature for the higher order component. It's easier to use generics
 * by separating out the type definition.
 */
export type WithChartViewport<
  ChartOwnProps: Object,
  // The chart component's props are given the viewport object, as well as the original
  // ChartOwnProps.
  ChartProps: $ReadOnly<{|
    ...ChartOwnProps,
    viewport: Viewport,
  |}>
> = (
  // Take as input a React component whose props accept the { +viewport: Viewport }.
  ChartComponent: React.ComponentType<ChartProps>
) => React.ComponentType<
  // Finally the returned component takes as input the InternalViewportProps, and
  // the ChartProps, but NOT { +viewport: Viewport }.
  ViewportOwnProps<ChartOwnProps>
>;

// Create the implementation of the WithChartViewport type, but let flow infer the
// generic parameters.
export const withChartViewport: WithChartViewport<*, *> =
  // ChartOwnProps is the only generic actually used in the implementation. Infer
  // the type signature of the arguments as the WithChartViewport will apply them.
  <ChartOwnProps>(
    ChartComponent: React.ComponentType<$Subtype<{ +viewport: Viewport }>>
  ): * => {
    type ViewportProps = ConnectedProps<
      ViewportOwnProps<ChartOwnProps>,
      ViewportStateProps,
      ViewportDispatchProps
    >;

    class ChartViewport extends React.PureComponent<ViewportProps, State> {
      zoomScrollId: number = 0;
      _pendingPreviewSelectionUpdates: Array<
        (HorizontalViewport) => PreviewSelection
      > = [];
      _container: HTMLElement | null = null;
      _takeContainerRef = container => {
        if (this.props.viewportProps.containerRef) {
          this.props.viewportProps.containerRef(container);
        }
        this._container = container;
      };
      _lastKeyboardNavigationFrame: number = 0;
      _keysDown: Set<NavigationKey> = new Set();
      _deltaToZoomFactor = delta => Math.pow(ZOOM_SPEED, delta);

      constructor(props: ViewportProps) {
        super(props);
        this.state = this.getDefaultState(props);
      }

      getHorizontalViewport(
        previewSelection: PreviewSelection,
        timeRange: StartEndRange
      ) {
        if (previewSelection.hasSelection) {
          const { selectionStart, selectionEnd } = previewSelection;
          const timeRangeLength = timeRange.end - timeRange.start;
          return {
            viewportLeft: (selectionStart - timeRange.start) / timeRangeLength,
            viewportRight: (selectionEnd - timeRange.start) / timeRangeLength,
          };
        }
        return {
          viewportLeft: 0,
          viewportRight: 1,
        };
      }

      getDefaultState(props: ViewportProps) {
        const { previewSelection, timeRange } = props.viewportProps;
        const horizontalViewport = this.getHorizontalViewport(
          previewSelection,
          timeRange
        );
        const { startsAtBottom, maxViewportHeight } = props.viewportProps;
        return {
          containerWidth: 0,
          containerHeight: 0,
          containerLeft: 0,
          viewportTop: 0,
          viewportBottom: startsAtBottom ? maxViewportHeight : 0,
          horizontalViewport,
          dragX: 0,
          dragY: 0,
          isDragging: false,
          isScrollHintVisible: false,
          isSizeSet: false,
        };
      }

      /**
       * Let the viewport know when we are actively scrolling.
       */
      showScrollingHint() {
        // Only show this message if we haven't ctrl/shift zoomed yet.
        if (this.props.hasZoomedViaMousewheel) {
          return;
        }

        const scrollId = ++this.zoomScrollId;
        if (!this.state.isScrollHintVisible) {
          this.setState({ isScrollHintVisible: true });
        }
        setTimeout(() => {
          if (scrollId === this.zoomScrollId) {
            this.setState({ isScrollHintVisible: false });
          }
        }, 1000);
      }

      UNSAFE_componentWillReceiveProps(newProps: ViewportProps) {
        if (
          this.props.viewportProps.viewportNeedsUpdate(
            this.props.chartProps,
            newProps.chartProps
          )
        ) {
          this.setState(this.getDefaultState(newProps));
          this._setSizeNextFrame();
        } else if (
          this.props.viewportProps.previewSelection !==
            newProps.viewportProps.previewSelection ||
          this.props.viewportProps.timeRange !==
            newProps.viewportProps.timeRange
        ) {
          const { previewSelection, timeRange } = newProps.viewportProps;
          const horizontalViewport = this.getHorizontalViewport(
            previewSelection,
            timeRange
          );
          this.setState({
            horizontalViewport,
          });
        } else if (
          this.props.panelLayoutGeneration !== newProps.panelLayoutGeneration
        ) {
          this._setSizeNextFrame();
        }
      }

      _setSize = () => {
        if (this._container) {
          const rect = this._container.getBoundingClientRect();
          const { startsAtBottom } = this.props.viewportProps;
          if (
            this.state.containerWidth !== rect.width ||
            this.state.containerHeight !== rect.height
          ) {
            this.setState(prevState => ({
              containerWidth: rect.width,
              containerHeight: rect.height,
              containerLeft: rect.left,
              viewportBottom: startsAtBottom
                ? prevState.viewportBottom
                : prevState.viewportTop + rect.height,
              viewportTop: startsAtBottom
                ? prevState.viewportBottom - rect.height
                : prevState.viewportTop,
              isSizeSet: true,
            }));
          }
        }
      };

      _setSizeNextFrame = () => {
        requestAnimationFrame(this._setSize);
      };

      // To scroll and zoom the chart, we need to install a wheel event listener.
      // This listener needs to call `preventDefault()` in order to be able to
      // consume wheel events, so that the browser does not trigger additional
      // scrolling, zooming, or back/forward swiping for events that the Viewport
      // already handles. In other words, this listener cannot be a "passive"
      // event listener.
      // In the past, we were using ReactDOM's onWheel attribute to install the
      // event listener. However, this has two drawbacks:
      //
      //  1. It does not let us control which DOM element the listener is
      //     installed on - ReactDOM will use event delegation and install the
      //     actual listener on an ancester DOM node. More specifically, on
      //     React versions before v17, the listener will be installed on the
      //     document, and starting with v17 the listener will be installed on
      //     the React root.
      //  2. It does not let us control the event listener options ("passive").
      //
      // As a general rule, non-passive wheel event listeners should be attached
      // to an element that only covers the area of the page that actually needs
      // to consume wheel events - the listener should be scoped as "tightly" as
      // possible. That's because these listeners require additional roundtrips
      // to the main thread for asynchronous scrolling, and browsers have added
      // optimizations to ensure that this extra roundtrip only affects the area
      // of the page covered by the DOM subtree that the listener is attached to.
      // So we really don't want React to put our wheel event listener on the
      // document or on the React root; we want it to be on the DOM element for
      // our Viewport component so that there is no scrolling performance impact
      // on elements outside the Viewport component.
      // Another problem with React setting the listener on the document is the
      // fact that, due to a recent intervention by some browsers (at least
      // Firefox and Chrome), `preventDefault()` no longer has any effect in
      // wheel event listeners that are set on the document, unless that
      // listener is explicitly marked with `{passive: false}` (which React
      // doesn't let us do).
      //
      // So, instead of using a ReactDOM onWheel listener, we use a native DOM
      // wheel event listener. We set/unset it when the Viewport component
      // mounts/unmounts.
      // This solves both problems: It makes `preventDefault()` work, and it
      // limits the performance impact from the non-passiveness to the Viewport
      // component itself, so that scrolling outside of the Viewport can proceed
      // in a fully accelerated and asynchronous fashion.
      _mouseWheelListener = (event: WheelEvent) => {
        // We handle the wheel event, so disable the browser's handling, such
        // as back/forward swiping or scrolling.
        event.preventDefault();

        const { disableHorizontalMovement } = this.props.viewportProps;
        if (event.ctrlKey || event.shiftKey) {
          if (!disableHorizontalMovement) {
            // Pinch and zoom needs to be faster to feel nice, which happens on the
            // ctrlKey modifier.
            const zoomModifier = event.ctrlKey ? PINCH_ZOOM_FACTOR : 1;
            this.zoomWithMouseWheel(event, zoomModifier);
          }
          return;
        }

        if (!disableHorizontalMovement) {
          this.showScrollingHint();
        }

        // Do the work to move the viewport.
        const { containerHeight } = this.state;

        this.moveViewport(
          -getNormalizedScrollDelta(event, containerHeight, 'deltaX'),
          -getNormalizedScrollDelta(event, containerHeight, 'deltaY')
        );
      };

      /**
       * Add a batched update to the preview selection.
       *
       * This method works asynchronously in order to avoid spamming the redux store
       * with updates (which cause synchronous react renders) in response to mouse events.
       * The actual redux update happens in _flushPendingPreviewSelectionUpdates(), which
       * processes all queued updates from a requestAnimationFrame callback.
       */
      _addBatchedPreviewSelectionUpdate(
        callback: HorizontalViewport => PreviewSelection
      ) {
        if (this._pendingPreviewSelectionUpdates.length === 0) {
          requestAnimationFrame(() =>
            this._flushPendingPreviewSelectionUpdates()
          );
        }
        this._pendingPreviewSelectionUpdates.push(callback);
      }

      /**
       * Flush all batched preview selection updates at once, with only a single
       * call to update the Redux store.
       */
      _flushPendingPreviewSelectionUpdates() {
        if (this._pendingPreviewSelectionUpdates.length !== 0) {
          const pendingUpdates = this._pendingPreviewSelectionUpdates;
          this._pendingPreviewSelectionUpdates = [];
          const {
            updatePreviewSelection,
            viewportProps: { previewSelection, timeRange },
          } = this.props;
          let nextSelection = previewSelection;
          for (const callback of pendingUpdates) {
            const horizontalViewport = this.getHorizontalViewport(
              nextSelection,
              timeRange
            );
            nextSelection = callback(horizontalViewport);
          }
          updatePreviewSelection(nextSelection);
        }
      }

      zoomWithMouseWheel(
        event: WheelEvent,
        // Allow different handlers to make the zoom faster or slower.
        zoomModifier: number = 1
      ) {
        const {
          hasZoomedViaMousewheel,
          setHasZoomedViaMousewheel,
          viewportProps: { marginLeft, marginRight },
        } = this.props;
        if (!hasZoomedViaMousewheel && setHasZoomedViaMousewheel) {
          setHasZoomedViaMousewheel();
        }

        const deltaY = getNormalizedScrollDelta(
          event,
          this.state.containerHeight,
          // Shift is a modifier that will change some mice to scroll horizontally, check
          // for that here.
          event.deltaY === 0 ? 'deltaX' : 'deltaY'
        );
        const zoomFactor = this._deltaToZoomFactor(deltaY * zoomModifier);

        const mouseX = event.clientX;
        const { containerLeft, containerWidth } = this.state;
        const innerContainerWidth = containerWidth - marginLeft - marginRight;
        const mouseCenter =
          (mouseX - containerLeft - marginLeft) / innerContainerWidth;
        this.zoomRangeSelection(mouseCenter, zoomFactor);
      }

      zoomRangeSelection = (center, zoomFactor) => {
        const {
          disableHorizontalMovement,
          maximumZoom,
        } = this.props.viewportProps;
        if (disableHorizontalMovement) {
          return;
        }

        this._addBatchedPreviewSelectionUpdate(
          ({ viewportLeft, viewportRight }) => {
            const viewportLength = viewportRight - viewportLeft;
            const newViewportLength = clamp(
              maximumZoom,
              1,
              viewportLength * zoomFactor
            );
            const deltaViewportLength = newViewportLength - viewportLength;
            const newViewportLeft = clamp(
              0,
              1 - newViewportLength,
              viewportLeft - deltaViewportLength * center
            );
            const newViewportRight = clamp(
              newViewportLength,
              1,
              viewportRight + deltaViewportLength * (1 - center)
            );

            const {
              viewportProps: { timeRange },
            } = this.props;
            if (newViewportLeft === 0 && newViewportRight === 1) {
              return {
                hasSelection: false,
                isModifying: false,
              };
            }
            const timeRangeLength = timeRange.end - timeRange.start;
            return {
              hasSelection: true,
              isModifying: false,
              selectionStart:
                timeRange.start + timeRangeLength * newViewportLeft,
              selectionEnd:
                timeRange.start + timeRangeLength * newViewportRight,
            };
          }
        );
      };

      _mouseDownListener = (event: SyntheticMouseEvent<>) => {
        event.preventDefault();
        if (this._container) {
          this._container.focus();
        }

        window.addEventListener('mousemove', this._mouseMoveListener, true);
        window.addEventListener('mouseup', this._mouseUpListener, true);
      };

      _mouseMoveListener = (event: MouseEvent) => {
        event.preventDefault();

        let { dragX, dragY } = this.state;
        if (!this.state.isDragging) {
          dragX = event.clientX;
          dragY = event.clientY;
        }

        const offsetX = event.clientX - dragX;
        const offsetY = event.clientY - dragY;

        this.setState({
          dragX: event.clientX,
          dragY: event.clientY,
          isDragging: true,
        });

        this.moveViewport(offsetX, offsetY);
      };

      _keyDownListener = (
        event: { nativeEvent: KeyboardEvent } & SyntheticKeyboardEvent<>
      ) => {
        let navigationKey;
        if (
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          !event.metaKey
        ) {
          navigationKey = BARE_KEYMAP[event.nativeEvent.code];
        } else if (event.ctrlKey) {
          /* Having the ctrl key down changes the meaning of the key
           * it's modifying, so pick the navigation key from another keymap. */
          navigationKey = CTRL_KEYMAP[event.nativeEvent.code];
        }

        if (navigationKey !== undefined) {
          // Start requesting frames if there were no keys down before
          // this event triggered.
          if (this._keysDown.size === 0) {
            requestAnimationFrame(this._keyboardNavigation);
            this._lastKeyboardNavigationFrame = performance.now();
          }

          this._keysDown.add(navigationKey);
          event.preventDefault();
        }
      };

      _keyUpListener = (
        event: { nativeEvent: KeyboardEvent } & SyntheticKeyboardEvent<>
      ) => {
        if (!event.ctrlKey) {
          // The ctrl modifier might have been released here. Try to
          // delete all keys associated with the modifier. Since the
          // navigation is aliased with non-ctrl-modified keys also,
          // this will affect (stop) the operation even if it was
          // introduced without a ctrl-modified key.
          for (const code of getObjectValuesAsUnion(CTRL_KEYMAP)) {
            this._keysDown.delete(code);
          }
        }
        this._keysDown.delete(CTRL_KEYMAP[event.nativeEvent.code]);
        this._keysDown.delete(BARE_KEYMAP[event.nativeEvent.code]);
      };

      _keyboardNavigation = timestamp => {
        if (this._keysDown.size === 0) {
          // No keys are down, nothing to do.  Don't request a new
          // animation frame.
          return;
        }

        const delta = Math.min(
          KEYBOARD_NAVIGATION_SPEED *
            (timestamp - this._lastKeyboardNavigationFrame) *
            0.001,
          MAX_KEYBOARD_DELTA // Don't jump like crazy if we experience long janks
        );
        this._lastKeyboardNavigationFrame = timestamp;

        for (const navigationKey of this._keysDown.values()) {
          switch (navigationKey) {
            case 'zoomIn':
              this.zoomRangeSelection(0.5, this._deltaToZoomFactor(-delta));
              break;
            case 'zoomOut':
              this.zoomRangeSelection(0.5, this._deltaToZoomFactor(delta));
              break;
            case 'up':
              this.moveViewport(0, delta);
              break;
            case 'down':
              this.moveViewport(0, -delta);
              break;
            case 'left':
              this.moveViewport(delta, 0);
              break;
            case 'right':
              this.moveViewport(-delta, 0);
              break;
            default:
              throw assertExhaustiveCheck(navigationKey);
          }
        }
        requestAnimationFrame(this._keyboardNavigation);
      };

      moveViewport = (offsetX: CssPixels, offsetY: CssPixels): void => {
        const {
          viewportProps: {
            maxViewportHeight,
            timeRange,
            startsAtBottom,
            disableHorizontalMovement,
          },
        } = this.props;
        const {
          containerWidth,
          containerHeight,
          viewportTop,
          isSizeSet,
        } = this.state;

        if (!isSizeSet) {
          // Moving the viewport and calculating its dimensions
          // assumes its size is actually set. Just ignore the move
          // request if it's not.
          return;
        }

        // Calculate top and bottom in terms of pixels.
        let newViewportTop: CssPixels = viewportTop - offsetY;
        let newViewportBottom: CssPixels = newViewportTop + containerHeight;

        if (maxViewportHeight < containerHeight) {
          // If the view is extra small, anchor content to the top or bottom.
          if (startsAtBottom) {
            newViewportTop = maxViewportHeight - containerHeight;
            newViewportBottom = maxViewportHeight;
          } else {
            newViewportTop = 0;
            newViewportBottom = containerHeight;
          }
        } else if (newViewportBottom > maxViewportHeight) {
          // Constrain the viewport to the bottom.
          newViewportTop = maxViewportHeight - containerHeight;
          newViewportBottom = maxViewportHeight;
        } else if (newViewportTop < 0) {
          // Constrain the viewport to the top.
          newViewportTop = 0;
          newViewportBottom = containerHeight;
        }

        if (newViewportTop !== viewportTop) {
          this.setState({
            viewportTop: newViewportTop,
            viewportBottom: newViewportBottom,
          });
        }

        if (!disableHorizontalMovement) {
          this._addBatchedPreviewSelectionUpdate(
            ({ viewportLeft, viewportRight }) => {
              // Calculate left and right in terms of the unit interval of the profile range.
              const viewportLength = viewportRight - viewportLeft;
              if (viewportLength >= 1) {
                return {
                  hasSelection: false,
                  isModifying: false,
                };
              }
              const unitOffsetX = (viewportLength * offsetX) / containerWidth;
              let newViewportLeft = viewportLeft - unitOffsetX;
              let newViewportRight = viewportRight - unitOffsetX;
              if (newViewportLeft < 0) {
                newViewportLeft = 0;
                newViewportRight = viewportLength;
              }
              if (newViewportRight > 1) {
                newViewportLeft = 1 - viewportLength;
                newViewportRight = 1;
              }

              const timeRangeLength = timeRange.end - timeRange.start;
              return {
                hasSelection: true,
                isModifying: false,
                selectionStart:
                  timeRange.start + timeRangeLength * newViewportLeft,
                selectionEnd:
                  timeRange.start + timeRangeLength * newViewportRight,
              };
            }
          );
        }
      };

      _mouseUpListener = (event: MouseEvent) => {
        event.preventDefault();
        window.removeEventListener('mousemove', this._mouseMoveListener, true);
        window.removeEventListener('mouseup', this._mouseUpListener, true);
        this.setState({
          isDragging: false,
        });
      };

      componentDidMount() {
        window.addEventListener('resize', this._setSizeNextFrame, false);
        // The first _setSize ensures that the screen does not blip when mounting
        // the component, while the second ensures that it lays out correctly if the DOM
        // is not fully layed out correctly yet.
        this._setSize();
        this._setSizeNextFrame();
        if (this._container) {
          this._container.addEventListener('wheel', this._mouseWheelListener, {
            passive: false,
          });
        }
      }

      componentWillUnmount() {
        window.removeEventListener('resize', this._setSizeNextFrame, false);
        window.removeEventListener('mousemove', this._mouseMoveListener, true);
        window.removeEventListener('mouseup', this._mouseUpListener, true);
        if (this._container) {
          this._container.removeEventListener(
            'wheel',
            this._mouseWheelListener,
            { passive: false }
          );
        }
      }

      render() {
        const {
          chartProps,
          hasZoomedViaMousewheel,
          viewportProps: { className },
        } = this.props;

        const {
          containerWidth,
          containerHeight,
          viewportTop,
          viewportBottom,
          horizontalViewport: { viewportLeft, viewportRight },
          isDragging,
          isScrollHintVisible,
          isSizeSet,
        } = this.state;

        const viewportClassName = classNames(
          {
            chartViewport: true,
            dragging: isDragging,
          },
          className
        );

        const scrollClassName = classNames({
          chartViewportScroll: true,
          hidden: hasZoomedViaMousewheel || !isScrollHintVisible,
        });

        const viewport: Viewport = {
          containerWidth,
          containerHeight,
          viewportLeft,
          viewportRight,
          viewportTop,
          viewportBottom,
          isDragging,
          moveViewport: this.moveViewport,
          isSizeSet,
        };

        return (
          <div
            className={viewportClassName}
            onMouseDown={this._mouseDownListener}
            onKeyDown={this._keyDownListener}
            onKeyUp={this._keyUpListener}
            ref={this._takeContainerRef}
            tabIndex={0}
          >
            <ChartComponent {...chartProps} viewport={viewport} />
            <div className={scrollClassName}>
              Zoom Chart:
              <kbd className="chartViewportScrollKbd">Ctrl + Scroll</kbd>or
              <kbd className="chartViewportScrollKbd">Shift + Scroll</kbd>
            </div>
          </div>
        );
      }
    }

    // Connect this component so that it knows whether or not to nag the user to use ctrl
    // for zooming on range selections.
    return explicitConnect<
      ViewportOwnProps<ChartOwnProps>,
      ViewportStateProps,
      ViewportDispatchProps
    >({
      mapStateToProps: state => ({
        panelLayoutGeneration: getPanelLayoutGeneration(state),
        hasZoomedViaMousewheel: getHasZoomedViaMousewheel(state),
      }),
      mapDispatchToProps: { setHasZoomedViaMousewheel, updatePreviewSelection },
      component: ChartViewport,
    });
  };

function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

const SCROLL_LINE_SIZE = 15;

/**
 * Scroll wheel events can by of various types. Do the right thing by converting these
 * into CssPixels. https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode
 */
function getNormalizedScrollDelta(
  event: WheelEvent,
  pageHeight: number,
  key: 'deltaY' | 'deltaX'
): CssPixels {
  const delta = key === 'deltaY' ? event.deltaY : event.deltaX;
  switch (event.deltaMode) {
    case DOM_DELTA_PAGE:
      return delta * pageHeight;
    case DOM_DELTA_LINE:
      return delta * SCROLL_LINE_SIZE;
    default:
  }
  // Scroll by pixel.
  return delta;
}
