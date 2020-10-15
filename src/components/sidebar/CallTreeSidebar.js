/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';
import memoize from 'memoize-immutable';
import explicitConnect from 'firefox-profiler/utils/connect';
import { assertExhaustiveCheck } from 'firefox-profiler/utils/flow';
import {
  selectedThreadSelectors,
  selectedNodeSelectors,
} from 'firefox-profiler/selectors/per-thread';
import { getSelectedThreadsKey } from 'firefox-profiler/selectors/url-state';
import { getCategories } from 'firefox-profiler/selectors/profile';
import { getFunctionName } from 'firefox-profiler/profile-logic/function-info';
import {
  getFriendlyStackTypeName,
  shouldDisplaySubcategoryInfoForCategory,
} from 'firefox-profiler/profile-logic/profile-data';
import { CanSelectContent } from './CanSelectContent';

import type { ConnectedProps } from 'firefox-profiler/utils/connect';
import type {
  ThreadsKey,
  CategoryList,
  CallNodeTable,
  IndexIntoCallNodeTable,
  TracedTiming,
  Milliseconds,
  WeightType,
} from 'firefox-profiler/types';

import type {
  BreakdownByImplementation,
  BreakdownByCategory,
  StackImplementation,
  TimingsForPath,
} from 'firefox-profiler/profile-logic/profile-data';
import {
  formatMilliseconds,
  formatPercent,
  formatBytes,
  formatNumber,
  ratioToCssPercent,
} from 'firefox-profiler/utils/format-numbers';
import classNames from 'classnames';

type SidebarDetailProps = {|
  +label: React.Node,
  +color?: string,
  +indent?: boolean,
  +value: React.Node,
  +percentage?: string | number,
|};

function SidebarDetail({
  label,
  value,
  percentage,
  indent,
}: SidebarDetailProps) {
  return (
    <React.Fragment>
      <div
        className={classNames({
          'sidebar-label': true,
          'sidebar-label-indent': indent,
        })}
      >
        {label}
      </div>
      <div className="sidebar-percentage">{percentage}</div>
      <div className="sidebar-value">{value}</div>
    </React.Fragment>
  );
}

type ImplementationBreakdownProps = {|
  +breakdown: BreakdownByImplementation,
  +number: number => string,
|};

// This component is responsible for displaying the breakdown data specific to
// the JavaScript engine and native code implementation.
class ImplementationBreakdown extends React.PureComponent<ImplementationBreakdownProps> {
  _orderedImplementations: $ReadOnlyArray<StackImplementation> = [
    'native',
    'interpreter',
    'blinterp',
    'baseline',
    'ion',
    'unknown',
  ];

  render() {
    const { breakdown, number } = this.props;

    const data: Array<{| +group: string, +value: Milliseconds | number |}> = [];

    for (const implementation of this._orderedImplementations) {
      const value = breakdown[implementation];
      if (!value && implementation === 'unknown') {
        continue;
      }

      data.push({
        group: getFriendlyStackTypeName(implementation),
        value: value || 0,
      });
    }

    const totalTime = data.reduce<number>(
      (result, item) => result + item.value,
      0
    );

    return data
      .filter(({ value }) => value)
      .map(({ group, value }) => {
        return (
          <React.Fragment key={group}>
            <SidebarDetail
              label={group}
              value={number(value)}
              percentage={formatPercent(value / totalTime)}
            />
            {/* Draw a histogram bar. */}
            <div className="sidebar-histogram-bar">
              <div
                className="sidebar-histogram-bar-color"
                style={{
                  width: ratioToCssPercent(value / totalTime),
                  backgroundColor: 'var(--grey-50)',
                }}
              ></div>
            </div>
          </React.Fragment>
        );
      });
  }
}

type CategoryBreakdownProps = {|
  +breakdown: BreakdownByCategory,
  +categoryList: CategoryList,
  +number: number => string,
|};

type CategoryBreakdownState = {|
  +openCategories: Set<string>,
|};

class CategoryBreakdown extends React.PureComponent<
  CategoryBreakdownProps,
  CategoryBreakdownState
> {
  state = {
    openCategories: new Set(),
  };

  _toggleCategory = (event: SyntheticInputEvent<>) => {
    const { category } = event.target.dataset;
    if (typeof category !== 'string') {
      throw new Error('Expected to find a category on the clicked element.');
    }
    this.setState(({ openCategories }) => {
      const newCategories = new Set(openCategories);
      if (openCategories.has(category)) {
        newCategories.delete(category);
      } else {
        newCategories.add(category);
      }
      return { openCategories: newCategories };
    });
  };

  render() {
    const { breakdown, categoryList, number } = this.props;

    const data = breakdown
      .map((oneCategoryBreakdown, categoryIndex) => {
        const category = categoryList[categoryIndex];
        return {
          category,
          value: oneCategoryBreakdown.entireCategoryValue || 0,
          subcategories: category.subcategories
            .map((subcategoryName, subcategoryIndex) => ({
              name: subcategoryName,
              value:
                oneCategoryBreakdown.subcategoryBreakdown[subcategoryIndex],
            }))
            // sort subcategories in descending order
            .sort(({ value: valueA }, { value: valueB }) => valueB - valueA)
            .filter(({ value }) => value),
        };
      })
      // sort categories in descending order
      .sort(({ value: valueA }, { value: valueB }) => valueB - valueA)
      .filter(({ value }) => value);

    // Values can be negative for diffing tracks, that's why we use the absolute
    // value to compute the total time. Indeed even if all values average out,
    // we want to display a sensible percentage.
    const totalTime = data.reduce(
      (accum, { value }) => accum + Math.abs(value),
      0
    );

    const { openCategories } = this.state;

    return (
      <>
        {data.map(({ category, value, subcategories }) => {
          const hasSubcategory = shouldDisplaySubcategoryInfoForCategory(
            category
          );
          const expanded = openCategories.has(category.name);
          return (
            <React.Fragment key={category.name}>
              <SidebarDetail
                label={
                  hasSubcategory ? (
                    <button
                      type="button"
                      data-category={category.name}
                      onClick={this._toggleCategory}
                      className={classNames({
                        'sidebar-toggle': true,
                        expanded,
                      })}
                    >
                      {category.name}
                    </button>
                  ) : (
                    category.name
                  )
                }
                value={number(value)}
                percentage={formatPercent(value / totalTime)}
              />

              {/* Draw a histogram bar, colored by the category. */}
              <div className="sidebar-histogram-bar">
                <div
                  className={`sidebar-histogram-bar-color category-color-${category.color}`}
                  style={{ width: ratioToCssPercent(value / totalTime) }}
                ></div>
              </div>

              {hasSubcategory && expanded
                ? subcategories.map(({ name, value }) => (
                    <SidebarDetail
                      key={name}
                      label={name}
                      value={number(value)}
                      percentage={formatPercent(value / totalTime)}
                      indent={true}
                    />
                  ))
                : null}
            </React.Fragment>
          );
        })}
      </>
    );
  }
}

type StateProps = {|
  +selectedNodeIndex: IndexIntoCallNodeTable | null,
  +callNodeTable: CallNodeTable,
  +selectedThreadsKey: ThreadsKey,
  +name: string,
  +lib: string,
  +timings: TimingsForPath,
  +categoryList: CategoryList,
  +weightType: WeightType,
  +tracedTiming: TracedTiming | null,
|};

type Props = ConnectedProps<{||}, StateProps, {||}>;

type WeightDetails = {|
  +running: string,
  +self: string,
  +number: (n: number) => string,
|};

function getWeightTypeLabel(weightType: WeightType): string {
  switch (weightType) {
    case 'tracing-ms':
      return `milliseconds`;
    case 'samples':
      return 'sample count';
    case 'bytes':
      return 'bytes';
    default:
      throw assertExhaustiveCheck(weightType, 'Unhandled WeightType.');
  }
}

class CallTreeSidebarImpl extends React.PureComponent<Props> {
  _getWeightTypeDetails = memoize(
    (weightType: WeightType): WeightDetails => {
      switch (weightType) {
        case 'tracing-ms':
          return {
            running: 'Running time',
            self: 'Self time',
            number: n => formatMilliseconds(n, 3, 1),
          };
        case 'samples':
          return {
            running: 'Running samples',
            self: 'Self samples',
            number: n => formatNumber(n, 0),
          };
        case 'bytes':
          return {
            running: 'Running size',
            self: 'Self size',
            number: n => formatBytes(n),
          };
        default:
          throw assertExhaustiveCheck(weightType, 'Unhandled WeightType.');
      }
    },
    { cache: new Map() }
  );

  render() {
    const {
      selectedNodeIndex,
      name,
      lib,
      timings,
      categoryList,
      weightType,
      tracedTiming,
    } = this.props;
    const {
      forPath: { selfTime, totalTime },
      rootTime,
    } = timings;

    if (selectedNodeIndex === null) {
      return (
        <div className="sidebar sidebar-calltree">
          Select a node to display some information about it.
        </div>
      );
    }

    const { number, running, self } = this._getWeightTypeDetails(weightType);

    const totalTimePercent = Math.round((totalTime.value / rootTime) * 100);
    const selfTimePercent = Math.round((selfTime.value / rootTime) * 100);
    const totalTimeBreakdownByCategory = totalTime.breakdownByCategory;
    const totalTimeBreakdownByImplementation =
      totalTime.breakdownByImplementation;
    const selfTimeBreakdownByImplementation =
      selfTime.breakdownByImplementation;

    return (
      <aside className="sidebar sidebar-calltree">
        <div className="sidebar-contents-wrapper">
          <header className="sidebar-titlegroup">
            <CanSelectContent
              tagName="h2"
              className="sidebar-title"
              content={name}
            />
            {lib ? (
              <CanSelectContent
                tagName="p"
                className="sidebar-subtitle"
                content={lib}
              />
            ) : null}
          </header>
          <h4 className="sidebar-title3">
            <div>Call node details</div>
          </h4>
          {tracedTiming ? (
            <SidebarDetail
              label="Traced running time"
              value={formatMilliseconds(
                tracedTiming.running[selectedNodeIndex],
                3,
                1
              )}
            ></SidebarDetail>
          ) : null}
          {tracedTiming ? (
            <SidebarDetail
              label="Traced self time"
              value={
                tracedTiming.self[selectedNodeIndex] === 0
                  ? '—'
                  : formatMilliseconds(
                      tracedTiming.self[selectedNodeIndex],
                      3,
                      1
                    )
              }
            />
          ) : null}
          <SidebarDetail
            label={running}
            value={totalTime.value ? `${number(totalTime.value)}` : '—'}
            percentage={totalTimePercent ? totalTimePercent + '%' : '—'}
          />
          <SidebarDetail
            label={self}
            value={selfTime.value ? `${number(selfTime.value)}` : '—'}
            percentage={selfTimePercent ? selfTimePercent + '%' : '—'}
          />
          {totalTimeBreakdownByCategory ? (
            <>
              <h4 className="sidebar-title3 sidebar-title-label">
                <div className="sidebar-title-label-left">Categories</div>
                <div className="sidebar-title-label-right">
                  Running {getWeightTypeLabel(weightType)}
                </div>
              </h4>
              <CategoryBreakdown
                breakdown={totalTimeBreakdownByCategory}
                categoryList={categoryList}
                number={number}
              />
            </>
          ) : null}
          {totalTimeBreakdownByImplementation && totalTime.value ? (
            <React.Fragment>
              <h4 className="sidebar-title3 sidebar-title-label">
                <div>Implementation</div>
                <div>Running {getWeightTypeLabel(weightType)}</div>
              </h4>
              <ImplementationBreakdown
                breakdown={totalTimeBreakdownByImplementation}
                number={number}
              />
            </React.Fragment>
          ) : null}
          {selfTimeBreakdownByImplementation && selfTime.value ? (
            <React.Fragment>
              <h4 className="sidebar-title3 sidebar-title-label">
                <div>Implementation</div>
                <div>Self {getWeightTypeLabel(weightType)}</div>
              </h4>
              <ImplementationBreakdown
                breakdown={selfTimeBreakdownByImplementation}
                number={number}
              />
            </React.Fragment>
          ) : null}
        </div>
      </aside>
    );
  }
}

export const CallTreeSidebar = explicitConnect<{||}, StateProps, {||}>({
  mapStateToProps: state => ({
    selectedNodeIndex: selectedThreadSelectors.getSelectedCallNodeIndex(state),
    callNodeTable: selectedThreadSelectors.getCallNodeInfo(state).callNodeTable,
    selectedThreadsKey: getSelectedThreadsKey(state),
    name: getFunctionName(selectedNodeSelectors.getName(state)),
    lib: selectedNodeSelectors.getLib(state),
    timings: selectedNodeSelectors.getTimingsForSidebar(state),
    categoryList: getCategories(state),
    weightType: selectedThreadSelectors.getWeightTypeForCallTree(state),
    tracedTiming: selectedThreadSelectors.getTracedTiming(state),
  }),
  component: CallTreeSidebarImpl,
});
