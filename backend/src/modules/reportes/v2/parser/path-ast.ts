export type AggregatorType = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'first' | 'last' | 'concat';

export interface FilterSelector {
  type: 'filter';
  filters: Array<{ field: string; value: string }>;
}

export interface AggregatorSelector {
  type: 'aggregator';
  aggregator: AggregatorType;
}

export interface IndexerSelector {
  type: 'indexer';
  index: number;
}

export type Selector = FilterSelector | AggregatorSelector | IndexerSelector;

export interface PathSegment {
  name: string;
  modifiers: Selector[];
}

export interface PathAST {
  segments: PathSegment[];
  raw: string;
}
