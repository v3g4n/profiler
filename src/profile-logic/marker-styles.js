/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow
import * as colors from 'photon-colors';

import type { CssPixels, Marker } from 'firefox-profiler/types';

type MarkerStyle = {|
  +top: CssPixels,
  +height: CssPixels,
  +background: string,
  +squareCorners: boolean,
  +borderLeft: null | string,
  +borderRight: null | string,
|};

const defaultStyle = {
  top: 0,
  height: 6,
  background: 'black',
  squareCorners: false,
  borderLeft: null,
  borderRight: null,
};

const gcStyle = {
  ...defaultStyle,
  top: 6,
  // This color is a yellower ORANGE_50 to help distinguish GC as coming from scripts.
  // It keeps it within a similar hue as the rest of the memory markers.
  background: '#ffc600',
};

const ccStyle = {
  ...gcStyle,
  background: colors.ORANGE_50,
};

/**
 * Get the marker style. Start off by looking at the marker name, then fallback to
 * the marker type.
 */
export function getMarkerStyle(marker: Marker): MarkerStyle {
  const { data, name } = marker;
  if (name in markerStyles) {
    return markerStyles[name];
  }
  if (data && data.type in markerStyles) {
    return markerStyles[data.type];
  }
  return markerStyles.default;
}

const markerStyles: { +[styleName: string]: MarkerStyle } = {
  default: defaultStyle,
  RefreshDriverTick: {
    ...defaultStyle,
    background: 'hsla(0,0%,0%,0.05)',
    height: 18,
    squareCorners: true,
  },
  RD: {
    ...defaultStyle,
    background: 'hsla(0,0%,0%,0.05)',
    height: 18,
    squareCorners: true,
  },
  Scripts: {
    ...defaultStyle,
    background: colors.ORANGE_70,
    top: 6,
  },
  Styles: {
    ...defaultStyle,
    background: colors.TEAL_50,
    top: 7,
  },
  FireScrollEvent: {
    ...defaultStyle,
    background: colors.ORANGE_70,
    top: 7,
  },
  Reflow: {
    ...defaultStyle,
    background: colors.BLUE_50,
    top: 7,
  },
  DispatchSynthMouseMove: {
    ...defaultStyle,
    background: colors.ORANGE_70,
    top: 8,
  },
  DisplayList: {
    ...defaultStyle,
    background: colors.PURPLE_50,
    top: 9,
  },
  LayerBuilding: {
    ...defaultStyle,
    background: colors.ORANGE_50,
    top: 9,
  },
  Rasterize: {
    ...defaultStyle,
    background: colors.GREEN_50,
    top: 10,
  },
  ForwardTransaction: {
    ...defaultStyle,
    background: colors.RED_70,
    top: 11,
  },
  NotifyDidPaint: {
    ...defaultStyle,
    background: colors.GREY_40,
    top: 12,
  },
  LayerTransaction: {
    ...defaultStyle,
    background: colors.RED_70,
  },
  Composite: {
    ...defaultStyle,
    background: colors.BLUE_50,
  },
  Vsync: {
    ...defaultStyle,
    background: 'rgb(255, 128, 0)',
  },
  LayerContentGPU: {
    ...defaultStyle,
    background: 'rgba(0,200,0,0.5)',
  },
  LayerCompositorGPU: {
    ...defaultStyle,
    background: 'rgba(0,200,0,0.5)',
  },
  LayerOther: {
    ...defaultStyle,
    background: 'rgb(200,0,0)',
  },
  Jank: {
    ...defaultStyle,
    background: 'hsl(347, 100%, 60%)',
    borderLeft: colors.RED_50,
    borderRight: colors.RED_50,
    squareCorners: true,
  },
  // Memory:
  GCMajor: {
    ...gcStyle,
    squareCorners: true,
    top: 0,
  },
  GCSlice: gcStyle,
  GCMinor: gcStyle,
  CCSlice: gcStyle,
  IdleCCSlice: ccStyle,
  IdleForgetSkippable: ccStyle,
  ForgetSkippable: ccStyle,

  // IO:
  FileIO: {
    ...defaultStyle,
    background: colors.BLUE_50,
  },

  IPCOut: {
    ...defaultStyle,
    background: colors.BLUE_50,
    top: 2,
  },
  SyncIPCOut: {
    ...defaultStyle,
    background: colors.BLUE_70,
    top: 6,
  },
  IPCIn: {
    ...defaultStyle,
    background: colors.PURPLE_40,
    top: 13,
  },
  SyncIPCIn: {
    ...defaultStyle,
    background: colors.PURPLE_70,
    top: 17,
  },
};

export const overlayFills = {
  HOVERED: 'hsla(0,0%,100%,0.3)',
  PRESSED: 'rgba(0,0,0,0.3)',
};
