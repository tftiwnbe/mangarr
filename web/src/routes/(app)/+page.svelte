<!-- <script lang="ts"> -->
<!-- 	import Gallery from '$components/gallery/gallery.svelte'; -->
<!-- 	import * as TitleCard from '$elements/title-card'; -->
<!-- 	import { resolve } from '$app/paths'; -->
<!---->
<!-- 	interface Manga { -->
<!-- 		id: string; -->
<!-- 		title: string; -->
<!-- 		subtitle?: string; -->
<!-- 		coverImage: string; -->
<!-- 		badge?: { -->
<!-- 			text: string; -->
<!-- 			color?: 'blue' | 'red' | 'green' | 'yellow' | 'purple'; -->
<!-- 		}; -->
<!-- 		chapters?: number; -->
<!-- 		rating?: number; -->
<!-- 		url?: string; -->
<!-- 	} -->
<!---->
<!-- 	let data: Manga[] = $state([ -->
<!-- 		{ -->
<!-- 			id: '1', -->
<!-- 			title: 'One Piece', -->
<!-- 			coverImage: 'https://example.com/cover1.jpg', -->
<!-- 			year: 1997, -->
<!-- 			summary: 'Pirates adventure...', -->
<!-- 			chapters: 1100, -->
<!-- 			genre: 'Shounen', -->
<!-- 			status: 'ongoing' -->
<!-- 		}, -->
<!-- 		{ -->
<!-- 			id: '2', -->
<!-- 			title: 'Berserk', -->
<!-- 			coverImage: 'https://example.com/cover2.jpg', -->
<!-- 			year: 1989, -->
<!-- 			summary: 'Dark fantasy...', -->
<!-- 			chapters: 380, -->
<!-- 			genre: 'Seinen', -->
<!-- 			status: 'ongoing' -->
<!-- 		} -->
<!-- 	]); -->
<!-- 	// let { data } = $props(); -->
<!-- 	const mangaTitles: Manga[] = data; -->
<!-- </script> -->
<!---->
<!-- <Gallery -->
<!-- 	items={mangaTitles} -->
<!-- 	title="Popular Manga" -->
<!-- 	defaultView="grid" -->
<!-- 	availableViews={['grid', 'list', 'carousel']} -->
<!-- 	gridColumns={{ sm: 2, md: 3, lg: 4, xl: 5 }} -->
<!-- 	carouselOptions={{ showArrows: true, itemsPerView: { sm: 2, md: 3, lg: 4, xl: 6 } }} -->
<!-- > -->
<!-- 	{#snippet renderItem(manga: Manga, view)} -->
<!-- 		<TitleCard.Root {view} href={resolve(manga.url || `/manga/${manga.id}`)}> -->
<!-- 			<TitleCard.Cover src={manga.coverImage} alt={manga.title} /> -->
<!---->
<!-- 			{#if manga.badge} -->
<!-- 				<TitleCard.Badge color={manga.badge.color}> -->
<!-- 					{manga.badge.text} -->
<!-- 				</TitleCard.Badge> -->
<!-- 			{/if} -->
<!---->
<!-- 			<TitleCard.Overlay> -->
<!-- 				<TitleCard.Content> -->
<!-- 					<TitleCard.Title>{manga.title}</TitleCard.Title> -->
<!---->
<!-- 					{#if manga.subtitle} -->
<!-- 						<TitleCard.Subtitle>{manga.subtitle}</TitleCard.Subtitle> -->
<!-- 					{/if} -->
<!---->
<!-- 					{#if manga.chapters || manga.rating} -->
<!-- 						<TitleCard.Meta> -->
<!-- 							{#if manga.chapters} -->
<!-- 								<span>{manga.chapters} chapters</span> -->
<!-- 							{/if} -->
<!-- 							{#if manga.rating} -->
<!-- 								<span class="flex items-center gap-1"> -->
<!-- 									<svg -->
<!-- 										class="size-3 fill-yellow-400" -->
<!-- 										viewBox="0 0 20 20" -->
<!-- 										xmlns="http://www.w3.org/2000/svg" -->
<!-- 									> -->
<!-- 										<path -->
<!-- 											d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" -->
<!-- 										/> -->
<!-- 									</svg> -->
<!-- 									{manga.rating.toFixed(1)} -->
<!-- 								</span> -->
<!-- 							{/if} -->
<!-- 						</TitleCard.Meta> -->
<!-- 					{/if} -->
<!-- 				</TitleCard.Content> -->
<!-- 			</TitleCard.Overlay> -->
<!---->
<!-- 			{#if view === 'grid'} -->
<!-- 				<div class="p-3 md:hidden"> -->
<!-- 					<h3 class="line-clamp-2 text-sm font-medium">{manga.title}</h3> -->
<!-- 					{#if manga.chapters} -->
<!-- 						<p class="mt-1 text-xs text-muted-foreground">{manga.chapters} chapters</p> -->
<!-- 					{/if} -->
<!-- 				</div> -->
<!-- 			{:else if view === 'list'} -->
<!-- 				<TitleCard.Content> -->
<!-- 					<div class="flex items-start justify-between gap-2"> -->
<!-- 						<TitleCard.Title>{manga.title}</TitleCard.Title> -->
<!---->
<!-- 						{#if manga.badge} -->
<!-- 							<TitleCard.Badge color={manga.badge.color}> -->
<!-- 								{manga.badge.text} -->
<!-- 							</TitleCard.Badge> -->
<!-- 						{/if} -->
<!-- 					</div> -->
<!---->
<!-- 					{#if manga.subtitle} -->
<!-- 						<TitleCard.Subtitle>{manga.subtitle}</TitleCard.Subtitle> -->
<!-- 					{/if} -->
<!---->
<!-- 					{#if manga.chapters || manga.rating} -->
<!-- 						<TitleCard.Meta> -->
<!-- 							{#if manga.chapters} -->
<!-- 								<span>{manga.chapters} chapters</span> -->
<!-- 							{/if} -->
<!-- 							{#if manga.rating} -->
<!-- 								<span class="flex items-center gap-1"> -->
<!-- 									<svg -->
<!-- 										class="size-3 fill-yellow-500" -->
<!-- 										viewBox="0 0 20 20" -->
<!-- 										xmlns="http://www.w3.org/2000/svg" -->
<!-- 									> -->
<!-- 										<path -->
<!-- 											d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" -->
<!-- 										/> -->
<!-- 									</svg> -->
<!-- 									{manga.rating.toFixed(1)} -->
<!-- 								</span> -->
<!-- 							{/if} -->
<!-- 						</TitleCard.Meta> -->
<!-- 					{/if} -->
<!-- 				</TitleCard.Content> -->
<!-- 			{/if} -->
<!-- 		</TitleCard.Root> -->
<!-- 	{/snippet} -->
<!---->
<!-- 	{#snippet emptyState()} -->
<!-- 		<div class="flex flex-col items-center justify-center py-12 text-center"> -->
<!-- 			<p class="text-muted-foreground">No manga titles available</p> -->
<!-- 		</div> -->
<!-- 	{/snippet} -->
<!-- </Gallery> -->
