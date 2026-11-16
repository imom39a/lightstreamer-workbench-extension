import { memo } from "react";

import { FilterDraftDocument } from "./filter-workflow";

/**
 * The Filter Draft composer, memoized. `useFilterComposer` supplies
 * identity-stable refs, setters, delegating handlers, and a narrow Evidence
 * view, so unrelated publications do not re-render the open composer.
 */
export const FilterRegion = memo(FilterDraftDocument);
