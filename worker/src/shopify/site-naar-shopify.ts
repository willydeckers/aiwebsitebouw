import type { PaginaMeta, SiteBron } from "../shared/site-builder.js";

// Maps a generated multi-page site onto Shopify's own content model.
//
// This is the piece that was missing from the Shopify path: a store could be
// created and a token obtained, but nothing ever put the generated site inside
// it. shopify-build-job.ts has described the intended mapping in a comment
// since July; this makes it real.
//
// The mapping works precisely because of how the site builder already splits
// things up. A `SiteBron` holds page bodies that contain no nav, no footer and
// no <head> — which is exactly what a Shopify page body must be, because the
// theme supplies all three. So the split that exists to keep the static demo
// consistent is the same split Shopify needs:
//
//   bron.paginas    -> one pageCreate each (titel -> title, bestand -> handle)
//   bron.bodies[x]  -> that page's body HTML, as-is
//   bron.nav        -> a Menu of MenuItems pointing at those page handles
//   bron.footer     -> dropped; the theme's own footer section owns this
//   bron.head       -> dropped; fonts and Tailwind config are theme concerns
//
// Verified against the live Admin API schema before writing: pageCreate,
// menuCreate, menuUpdate and themePublish all exist. Note that menuCreate
// needs `write_online_store_navigation`, which is a separate scope from
// write_content — see VEREISTE_SCOPES.

/** index.html is the storefront home page, which a theme renders — it must not
 *  also become a Page, or the store gets a duplicate "Home" in its navigation. */
export const HOME_BESTAND = "index.html";

export type ShopifyPagina = {
  /** Source file, kept so results can be matched back to the site. */
  bestand: string;
  title: string;
  handle: string;
  body: string;
  isPublished: boolean;
};

export type ShopifyMenuItem = {
  title: string;
  type: "PAGE" | "HTTP";
  /** Set for PAGE items once the page exists and its gid is known. */
  resourceId?: string;
  url?: string;
  items?: ShopifyMenuItem[];
};

/**
 * Shopify derives a page's URL from its handle, and rejects anything that
 * isn't lowercase alphanumeric plus hyphens. The site builder already
 * constrains file names to that shape, so this is mostly stripping ".html" —
 * but it stays defensive, since a bad handle fails the mutation with a
 * validation error rather than anything readable.
 */
export function handleVoor(bestand: string): string {
  return bestand
    .replace(/\.html$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * The pages to create, in site order, minus the home page.
 *
 * Protected pages are skipped entirely rather than created unpublished: the
 * gate that protects them lives in track-and-serve, and Shopify has no
 * equivalent. Publishing that content here would quietly remove the protection
 * the site was built with, which is worse than not porting it.
 */
export function paginasVoorShopify(bron: SiteBron): ShopifyPagina[] {
  return bron.paginas
    .filter((p) => p.bestand !== HOME_BESTAND)
    .filter((p) => p.toegang !== "beveiligd")
    .map((pagina) => ({
      bestand: pagina.bestand,
      title: pagina.titel,
      handle: handleVoor(pagina.bestand),
      body: bron.bodies[pagina.bestand] ?? "",
      isPublished: true,
    }));
}

/** Pages left out of the port, with the reason — surfaced to the user rather
 *  than silently dropped. */
export function overgeslagenPaginas(bron: SiteBron): { bestand: string; reden: string }[] {
  return bron.paginas
    .filter((p) => p.toegang === "beveiligd")
    .map((p) => ({
      bestand: p.bestand,
      reden:
        "afgeschermde pagina — Shopify heeft geen equivalent voor de toegangscode, " +
        "dus deze is niet overgezet in plaats van hem publiek te maken",
    }));
}

/**
 * The navigation, built from the site's own hierarchy rather than from the
 * generated nav markup. Parsing that HTML back into menu items would be
 * guesswork; the page tree already says what the menu should be, and it's the
 * same tree the breadcrumb and the active-page marking use.
 *
 * `paginaGids` maps bestand -> Shopify page gid, filled in after the pages
 * have been created.
 */
export function menuItemsVoorShopify(
  bron: SiteBron,
  paginaGids: Record<string, string>,
): ShopifyMenuItem[] {
  const zichtbaar = bron.paginas.filter((p) => p.toegang !== "beveiligd");
  const hoofdpaginas = zichtbaar.filter((p) => !p.ouder);

  const itemVoor = (pagina: PaginaMeta): ShopifyMenuItem | null => {
    if (pagina.bestand === HOME_BESTAND) {
      // Home is the storefront root, not a Page resource.
      return { title: pagina.nav_label, type: "HTTP", url: "/" };
    }
    const gid = paginaGids[pagina.bestand];
    if (!gid) return null;
    return { title: pagina.nav_label, type: "PAGE", resourceId: gid };
  };

  const items: ShopifyMenuItem[] = [];
  for (const pagina of hoofdpaginas) {
    const item = itemVoor(pagina);
    if (!item) continue;

    // One level of nesting, matching what the site builder allows. Shopify
    // supports three, but inventing depth the site doesn't have would produce
    // a menu that disagrees with the demo the client already approved.
    const kinderen = zichtbaar
      .filter((k) => k.ouder === pagina.bestand)
      .map(itemVoor)
      .filter((k): k is ShopifyMenuItem => k !== null);

    if (kinderen.length) item.items = kinderen;
    items.push(item);
  }
  return items;
}

/** Shopify's main menu always has this handle; updating it is what actually
 *  changes the storefront nav, whereas creating a second menu just adds an
 *  unused one. */
export const HOOFDMENU_HANDLE = "main-menu";

export const PAGE_CREATE = `
  mutation MaakPagina($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id title handle }
      userErrors { code field message }
    }
  }`;

export const MENU_CREATE = `
  mutation MaakMenu($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu { id handle }
      userErrors { code field message }
    }
  }`;

export const MENU_UPDATE = `
  mutation WerkMenuBij($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
      menu { id handle }
      userErrors { code field message }
    }
  }`;

export const MENU_QUERY = `
  query Hoofdmenu {
    menus(first: 20) { nodes { id handle title } }
  }`;
