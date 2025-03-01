import { CommonProperty, Schema } from "@fern-fern/openapi-ir-model/ir";
import { OpenAPIV3 } from "openapi-types";
import { AbstractOpenAPIV3ParserContext } from "../../AbstractOpenAPIV3ParserContext";
import { convertReferenceObject, convertSchema, convertSchemaObject } from "../convertSchemas";

export function convertDiscriminatedOneOf({
    nameOverride,
    generatedName,
    breadcrumbs,
    properties,
    description,
    required,
    wrapAsNullable,
    discriminator,
    context,
}: {
    nameOverride: string | undefined;
    generatedName: string;
    breadcrumbs: string[];
    properties: Record<string, OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject>;
    description: string | undefined;
    required: string[] | undefined;
    wrapAsNullable: boolean;
    discriminator: OpenAPIV3.DiscriminatorObject;
    context: AbstractOpenAPIV3ParserContext;
}): Schema {
    const discriminant = discriminator.propertyName;
    const unionSubTypes = Object.fromEntries(
        Object.entries(discriminator.mapping ?? {}).map(([discriminantValue, schema]) => {
            const subtypeReference = convertReferenceObject(
                {
                    $ref: schema,
                },
                false,
                [schema]
            );
            context.markReferencedByDiscriminatedUnion(
                {
                    $ref: schema,
                },
                discriminant
            );
            return [discriminantValue, subtypeReference];
        })
    );
    const convertedProperties = Object.entries(properties)
        .filter(([propertyName]) => {
            return propertyName !== discriminant;
        })
        .map(([propertyName, propertySchema]) => {
            const isRequired = required != null && required.includes(propertyName);
            const schema = convertSchema(propertySchema, !isRequired, context, [...breadcrumbs, propertyName]);
            return {
                key: propertyName,
                schema,
            };
        });
    return wrapDiscriminantedOneOf({
        nameOverride,
        generatedName,
        wrapAsNullable,
        properties: convertedProperties,
        description,
        discriminant,
        subtypes: unionSubTypes,
    });
}

export function convertDiscriminatedOneOfWithVariants({
    nameOverride,
    generatedName,
    breadcrumbs,
    properties,
    description,
    required,
    wrapAsNullable,
    discriminant,
    variants,
    context,
}: {
    nameOverride: string | undefined;
    generatedName: string;
    breadcrumbs: string[];
    properties: Record<string, OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject>;
    description: string | undefined;
    required: string[] | undefined;
    wrapAsNullable: boolean;
    discriminant: string;
    variants: Record<string, OpenAPIV3.SchemaObject>;
    context: AbstractOpenAPIV3ParserContext;
}): Schema {
    const unionSubTypes = Object.fromEntries(
        Object.entries(variants).map(([discriminantValue, schema]) => {
            const variantSchema = convertSchemaObject(
                schema,
                false,
                context,
                [...breadcrumbs, discriminantValue],
                new Set([discriminant])
            );
            return [discriminantValue, variantSchema];
        })
    );
    const convertedProperties = Object.entries(properties)
        .filter(([propertyName]) => {
            return propertyName !== discriminant;
        })
        .map(([propertyName, propertySchema]) => {
            const isRequired = required != null && required.includes(propertyName);
            const schema = convertSchema(propertySchema, !isRequired, context, [...breadcrumbs, propertyName]);
            return {
                key: propertyName,
                schema,
            };
        });
    return wrapDiscriminantedOneOf({
        nameOverride,
        generatedName,
        wrapAsNullable,
        properties: convertedProperties,
        description,
        discriminant,
        subtypes: unionSubTypes,
    });
}

export function wrapDiscriminantedOneOf({
    nameOverride,
    generatedName,
    wrapAsNullable,
    properties,
    description,
    discriminant,
    subtypes,
}: {
    nameOverride: string | undefined;
    generatedName: string;
    wrapAsNullable: boolean;
    properties: CommonProperty[];
    description: string | undefined;
    discriminant: string;
    subtypes: Record<string, Schema>;
}): Schema {
    if (wrapAsNullable) {
        return Schema.nullable({
            value: Schema.oneOf({
                type: "discriminated",
                description,
                discriminantProperty: discriminant,
                nameOverride,
                generatedName,
                schemas: subtypes,
                commonProperties: properties,
            }),
            description,
        });
    }
    return Schema.oneOf({
        type: "discriminated",
        description,
        discriminantProperty: discriminant,
        nameOverride,
        generatedName,
        schemas: subtypes,
        commonProperties: properties,
    });
}
