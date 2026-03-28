import type { GenericId } from 'convex/values';

import type { MutationCtx, QueryCtx } from './_generated/server';

export type InstalledSourceCatalogItem = {
	id: string;
	pkg: string;
	lang: string;
	name: string;
	enabled: boolean;
};

export async function loadInstalledSourceCatalog(ctx: QueryCtx | MutationCtx) {
	const extensions = await ctx.db.query('installedExtensions').collect();
	const byId = new Map<string, InstalledSourceCatalogItem>();
	const byPkg = new Map<string, InstalledSourceCatalogItem[]>();

	for (const extension of extensions) {
		const sources =
			extension.sources ??
			extension.sourceIds.map((id) => ({
				id,
				name: id,
				lang: extension.lang,
				supportsLatest: false,
				enabled: true
			}));
		for (const source of sources) {
			const item: InstalledSourceCatalogItem = {
				id: source.id,
				pkg: extension.pkg,
				lang: source.lang,
				name: source.name,
				enabled: source.enabled !== false
			};
			byId.set(item.id, item);
			const pkgItems = byPkg.get(item.pkg) ?? [];
			pkgItems.push(item);
			byPkg.set(item.pkg, pkgItems);
		}
	}

	return { byId, byPkg };
}

export function variantInstalledSourceRecord(
	catalog: { byId: Map<string, InstalledSourceCatalogItem> },
	variant: { sourceId: string; sourcePkg: string }
) {
	const installed = catalog.byId.get(variant.sourceId);
	return installed && installed.pkg === variant.sourcePkg ? installed : null;
}

export function pickVariantNormalizationAssignments(
	variants: Array<{
		_id: GenericId<'titleVariants'>;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
	}>,
	catalog: {
		byId: Map<string, InstalledSourceCatalogItem>;
		byPkg: Map<string, InstalledSourceCatalogItem[]>;
	}
) {
	const assignments = new Map<
		string,
		{
			sourceId: string;
			sourceLang: string;
			sourceName: string;
		}
	>();

	const variantsByPkg = new Map<string, typeof variants>();
	for (const variant of variants) {
		const pkgVariants = variantsByPkg.get(variant.sourcePkg) ?? [];
		pkgVariants.push(variant);
		variantsByPkg.set(variant.sourcePkg, pkgVariants);
	}

	for (const [sourcePkg, pkgVariants] of variantsByPkg.entries()) {
		const installedSources = catalog.byPkg.get(sourcePkg) ?? [];
		const activeSourceIds = new Set(
			pkgVariants
				.filter((variant) => variantInstalledSourceRecord(catalog, variant) !== null)
				.map((variant) => variant.sourceId)
		);
		const staleVariants = pkgVariants.filter(
			(variant) => variantInstalledSourceRecord(catalog, variant) === null
		);
		if (staleVariants.length === 0) continue;

		const remainingSources = installedSources.filter((source) => !activeSourceIds.has(source.id));
		const consumedSourceIds = new Set<string>();

		for (const variant of staleVariants) {
			const langMatches = remainingSources.filter(
				(source) => !consumedSourceIds.has(source.id) && source.lang === variant.sourceLang
			);
			if (langMatches.length === 1) {
				const matched = langMatches[0];
				assignments.set(String(variant._id), {
					sourceId: matched.id,
					sourceLang: matched.lang,
					sourceName: matched.name
				});
				consumedSourceIds.add(matched.id);
			}
		}

		const unresolved = staleVariants.filter((variant) => !assignments.has(String(variant._id)));
		const unresolvedRemainingSources = remainingSources.filter(
			(source) => !consumedSourceIds.has(source.id)
		);
		if (unresolved.length === 1 && unresolvedRemainingSources.length === 1) {
			const matched = unresolvedRemainingSources[0];
			assignments.set(String(unresolved[0]._id), {
				sourceId: matched.id,
				sourceLang: matched.lang,
				sourceName: matched.name
			});
		}
	}

	return assignments;
}
