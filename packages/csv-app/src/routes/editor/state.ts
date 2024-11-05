/**
 * State atoms for the editor route.
 */

import { atom } from "jotai";
import {
	lixAtom,
	fileIdSearchParamsAtom,
	withPollingAtom,
	currentBranchAtom,
} from "../../state.ts";
import Papa from "papaparse";
import {
	changeHasLabel,
	changeInBranch,
	changeIsLeafInBranch,
} from "@lix-js/sdk";

export const activeFileAtom = atom(async (get) => {
	get(withPollingAtom);
	const fileId = await get(fileIdSearchParamsAtom);

	if (!fileId) {
		// Not the best UX to implicitly route to the root
		// but fine for now.
		window.location.href = "/";
		throw new Error("no active file. reroute should avoid this throw");
	}

	const lix = await get(lixAtom);

	return await lix.db
		.selectFrom("file")
		.selectAll()
		.where("id", "=", fileId)
		.executeTakeFirstOrThrow();
});

export const parsedCsvAtom = atom(async (get) => {
	const file = await get(activeFileAtom);
	if (!file) throw new Error("No file selected");
	const data = await new Blob([file.data]).text();
	const parsed = Papa.parse(data, { header: true });
	return parsed as Papa.ParseResult<Record<string, string>>;
});

export const uniqueColumnAtom = atom<Promise<string | undefined>>(
	async (get) => {
		const file = await get(activeFileAtom);
		if (!file) return undefined;
		return file.metadata?.unique_column as string | undefined;
	}
);

export const uniqueColumnIndexAtom = atom(async (get) => {
	const uniqueColumn = await get(uniqueColumnAtom);
	const parsedCsv = await get(parsedCsvAtom);
	if (!uniqueColumn) return undefined;
	return parsedCsv.meta.fields!.indexOf(uniqueColumn);
});

/**
 * The entity id that is selected in the editor.
 */
export const activeCellAtom = atom<{
	colId?: string;
	col: number;
	row: number;
} | null>(null);

/**
 * The entity (row) id that is selected in the editor.
 */
export const activeRowEntityIdAtom = atom(async (get) => {
	const activeCell = get(activeCellAtom);
	const parsedCsv = await get(parsedCsvAtom);
	const uniqueColumn = await get(uniqueColumnAtom);
	if (!activeCell || !uniqueColumn) return null;
	const uniqueColumnValue = parsedCsv.data[activeCell.row]?.[uniqueColumn];
	return `${uniqueColumn}:${uniqueColumnValue}`;
});

/**
 * All changes for a given row.
 */
export const activeRowChangesAtom = atom(async (get) => {
	get(withPollingAtom);
	const activeFile = await get(activeFileAtom);
	const activeRowEntityId = await get(activeRowEntityIdAtom);
	const currentBranch = await get(currentBranchAtom);
	const lix = await get(lixAtom);
	if (!activeRowEntityId) return [];
	const changes = await lix.db
		.selectFrom("change")
		.where("change.type", "=", "row")
		.where("change.entity_id", "=", activeRowEntityId)
		.where("change.file_id", "=", activeFile.id)
		.where(changeInBranch(currentBranch))
		.innerJoin("snapshot", "snapshot.id", "change.snapshot_id")
		// .innerJoin("change_set_item", "change_set_item.change_id", "change.id")
		// .innerJoin("change_set", "change_set.id", "change_set_item.change_set_id")
		// .innerJoin("discussion", "discussion.change_set_id", "change_set.id")
		// .innerJoin("comment", "comment.discussion_id", "discussion.id")
		// .selectAll("change")
		// .select((eb) => eb.fn.count("comment.id").as("comment_count"))
		.select("snapshot.content")
		.selectAll("change")
		.orderBy("change.created_at", "desc")
		.execute();

	for (const change of changes) {
		const labels = await lix.db
			.selectFrom("label")
			.innerJoin("change_set_label", "change_set_label.label_id", "label.id")
			.innerJoin(
				"change_set",
				"change_set.id",
				"change_set_label.change_set_id"
			)
			.innerJoin(
				"change_set_element",
				"change_set_element.change_set_id",
				"change_set.id"
			)
			.where("change_set_element.change_id", "=", change.id)
			.select("label.name")
			.execute();

		// @ts-expect-error - labels is not in the type
		change.labels = labels.map((label) => label.name);
	}
	return changes;
});

// The CSV app treats changes that are not in a change set as unconfirmed changes.
export const unconfirmedChangesAtom = atom(async (get) => {
	get(withPollingAtom);
	const lix = await get(lixAtom);
	const activeFile = await get(activeFileAtom);
	const currentBranch = await get(currentBranchAtom);

	return await lix.db
		.selectFrom("change")
		.where("change.file_id", "=", activeFile.id)
		.where(changeIsLeafInBranch(currentBranch))
		.where((eb) => eb.not(changeHasLabel("confirmed")))
		.selectAll("change")
		.execute();
});

