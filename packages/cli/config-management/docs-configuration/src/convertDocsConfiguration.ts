import { assertNever } from "@fern-api/core-utils";
import { AbsoluteFilePath, dirname, doesPathExist, resolve } from "@fern-api/fs-utils";
import { TaskContext } from "@fern-api/task-context";
import { FernDocsConfig as RawDocs } from "@fern-fern/docs-config";
import { FernRegistry } from "@fern-fern/registry-node";
import {
    DocsConfiguration,
    DocsNavigationConfiguration,
    DocsNavigationItem,
    FontConfig,
    ImageReference,
    TypographyConfig,
} from "./DocsConfiguration";

export async function convertDocsConfiguration({
    rawDocsConfiguration,
    absolutePathOfConfiguration,
    context,
}: {
    rawDocsConfiguration: RawDocs.DocsConfiguration;
    absolutePathOfConfiguration: AbsoluteFilePath;
    context: TaskContext;
}): Promise<DocsConfiguration> {
    const { navigation, colors, favicon, backgroundImage, logo, navbarLinks, title, typography } = rawDocsConfiguration;
    return {
        navigation: await convertNavigationConfiguration({
            rawConfig: navigation,
            absolutePathOfConfiguration,
            context,
        }),
        title,
        logo:
            logo != null
                ? {
                      reference: await convertImageReference({
                          rawImageReference: typeof logo === "string" ? logo : logo.path,
                          absolutePathOfConfiguration,
                          context,
                      }),
                      height: typeof logo === "object" ? logo.height : undefined,
                      href: typeof logo === "object" ? FernRegistry.docs.v1.write.Url(logo.href) : undefined,
                  }
                : undefined,
        favicon:
            favicon != null
                ? await convertImageReference({ rawImageReference: favicon, absolutePathOfConfiguration, context })
                : undefined,
        backgroundImage:
            backgroundImage != null
                ? await convertImageReference({
                      rawImageReference: backgroundImage,
                      absolutePathOfConfiguration,
                      context,
                  })
                : undefined,
        colors: convertColorsConfiguration(colors ?? {}, context),
        navbarLinks: navbarLinks != null ? convertNavbarLinks(navbarLinks) : undefined,
        typography:
            typography != null
                ? await convertTypographyConfiguration({
                      rawTypography: typography,
                      absolutePathOfConfiguration,
                      context,
                  })
                : undefined,
    };
}

async function convertTypographyConfiguration({
    rawTypography,
    absolutePathOfConfiguration,
    context,
}: {
    rawTypography: RawDocs.DocsTypographyConfig;
    absolutePathOfConfiguration: AbsoluteFilePath;
    context: TaskContext;
}): Promise<TypographyConfig> {
    return {
        headingsFont:
            rawTypography.headingsFont != null
                ? await convertFontConfig({
                      rawFontConfig: rawTypography.headingsFont,
                      absolutePathOfConfiguration,
                      context,
                  })
                : undefined,
        bodyFont:
            rawTypography.bodyFont != null
                ? await convertFontConfig({
                      rawFontConfig: rawTypography.bodyFont,
                      absolutePathOfConfiguration,
                      context,
                  })
                : undefined,
        codeFont:
            rawTypography.codeFont != null
                ? await convertFontConfig({
                      rawFontConfig: rawTypography.codeFont,
                      absolutePathOfConfiguration,
                      context,
                  })
                : undefined,
    };
}

async function convertFontConfig({
    rawFontConfig,
    absolutePathOfConfiguration,
    context,
}: {
    rawFontConfig: RawDocs.FontConfig;
    absolutePathOfConfiguration: AbsoluteFilePath;
    context: TaskContext;
}): Promise<FontConfig> {
    return {
        name: rawFontConfig.name,
        absolutePath: await resolveAndValidateFilepath({
            absolutePathOfConfiguration,
            rawUnresolvedFilepath: rawFontConfig.path,
            context,
        }),
    };
}

async function convertNavigationConfiguration({
    rawConfig,
    absolutePathOfConfiguration,
    context,
}: {
    rawConfig: RawDocs.NavigationItem[];
    absolutePathOfConfiguration: AbsoluteFilePath;
    context: TaskContext;
}): Promise<DocsNavigationConfiguration> {
    return {
        items: await Promise.all(
            rawConfig.map((item) => convertNavigationItem({ rawConfig: item, absolutePathOfConfiguration, context }))
        ),
    };
}

async function convertNavigationItem({
    rawConfig,
    absolutePathOfConfiguration,
    context,
}: {
    rawConfig: RawDocs.NavigationItem;
    absolutePathOfConfiguration: AbsoluteFilePath;
    context: TaskContext;
}): Promise<DocsNavigationItem> {
    if (isRawPageConfig(rawConfig)) {
        return {
            type: "page",
            title: rawConfig.page,
            absolutePath: await resolveAndValidateFilepath({
                absolutePathOfConfiguration,
                rawUnresolvedFilepath: rawConfig.path,
                context,
            }),
            slug: rawConfig.slug ?? undefined,
        };
    }
    if (isRawSectionConfig(rawConfig)) {
        return {
            type: "section",
            title: rawConfig.section,
            contents: await Promise.all(
                rawConfig.contents.map((item) =>
                    convertNavigationItem({ rawConfig: item, absolutePathOfConfiguration, context })
                )
            ),
            slug: rawConfig.slug ?? undefined,
        };
    }
    if (isRawApiSectionConfig(rawConfig)) {
        return {
            type: "apiSection",
            title: rawConfig.api,
            audiences:
                rawConfig.audiences != null ? { type: "select", audiences: rawConfig.audiences } : { type: "all" },
        };
    }
    assertNever(rawConfig);
}

function isRawPageConfig(item: RawDocs.NavigationItem): item is RawDocs.PageConfiguration {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return (item as RawDocs.PageConfiguration).page != null;
}

function isRawSectionConfig(item: RawDocs.NavigationItem): item is RawDocs.SectionConfiguration {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return (item as RawDocs.SectionConfiguration).section != null;
}

function isRawApiSectionConfig(item: RawDocs.NavigationItem): item is RawDocs.ApiSectionConfiguration {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return (item as RawDocs.ApiSectionConfiguration).api != null;
}

async function convertImageReference({
    rawImageReference,
    absolutePathOfConfiguration,
    context,
}: {
    rawImageReference: string;
    absolutePathOfConfiguration: AbsoluteFilePath;
    context: TaskContext;
}): Promise<ImageReference> {
    return {
        filepath: await resolveAndValidateFilepath({
            absolutePathOfConfiguration,
            rawUnresolvedFilepath: rawImageReference,
            context,
        }),
    };
}

function convertColorsConfiguration(
    rawConfig: RawDocs.ColorsConfiguration,
    context: TaskContext
): FernRegistry.docs.v1.write.ColorsConfig {
    return {
        accentPrimary: convertHextoRgb(rawConfig, "accentPrimary", context),
    };
}

const HEX_COLOR_REGEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

function convertHextoRgb(
    rawConfig: RawDocs.ColorsConfiguration,
    key: keyof RawDocs.ColorsConfiguration,
    context: TaskContext
): FernRegistry.docs.v1.write.RgbColor | undefined {
    const color = rawConfig[key];
    if (color == null) {
        return undefined;
    }
    const rgb = hexToRgb(color);
    if (rgb != null) {
        return rgb;
    }
    context.failAndThrow(`${key} should be a hex color of the format #FFFFFF`);
}

// https://stackoverflow.com/a/5624139/4238485
function hexToRgb(hexString: string): FernRegistry.docs.v1.write.RgbColor | undefined {
    const result = HEX_COLOR_REGEX.exec(hexString);
    if (result != null) {
        const [_, rAsString, gAsString, bAsString] = result;
        const r = parseHexColorCode(rAsString);
        const g = parseHexColorCode(gAsString);
        const b = parseHexColorCode(bAsString);
        if (r != null && g != null && b != null) {
            return { r, g, b };
        }
    }
    return undefined;
}

function parseHexColorCode(value: string | undefined): number | undefined {
    if (value == null) {
        return undefined;
    }
    const valueAsNumber = parseInt(value, 16);
    if (isNaN(valueAsNumber)) {
        return undefined;
    }
    return valueAsNumber;
}

function convertNavbarLinks(rawConfig: RawDocs.NavbarLink[]): FernRegistry.docs.v1.write.NavbarLink[] {
    return rawConfig.map((rawNavbarLink) => {
        switch (rawNavbarLink.type) {
            case "primary":
                return FernRegistry.docs.v1.write.NavbarLink.primary({
                    text: rawNavbarLink.text,
                    url: rawNavbarLink.url,
                });
            case "secondary":
                return FernRegistry.docs.v1.write.NavbarLink.secondary({
                    text: rawNavbarLink.text,
                    url: rawNavbarLink.url,
                });
            default:
                assertNever(rawNavbarLink);
        }
    });
}

async function resolveAndValidateFilepath({
    rawUnresolvedFilepath,
    absolutePathOfConfiguration,
    context,
}: {
    rawUnresolvedFilepath: string;
    absolutePathOfConfiguration: AbsoluteFilePath;
    context: TaskContext;
}): Promise<AbsoluteFilePath> {
    const resolved = resolve(dirname(absolutePathOfConfiguration), rawUnresolvedFilepath);
    const pathExists = await doesPathExist(resolved);
    if (!pathExists) {
        context.failAndThrow("Path does not exist: " + rawUnresolvedFilepath);
    }
    return resolved;
}
