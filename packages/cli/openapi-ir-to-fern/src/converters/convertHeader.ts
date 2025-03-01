import { RawSchemas } from "@fern-api/yaml-schema";
import { Header, Schema, SchemaId } from "@fern-fern/openapi-ir-model/ir";
import { camelCase } from "lodash-es";
import { ROOT_PREFIX } from "../convertPackage";
import { convertToTypeReference } from "./convertToTypeReference";
import { getTypeFromTypeReference } from "./utils/getTypeFromTypeReference";

export interface ConvertedHeader {
    value: RawSchemas.HttpHeaderSchema;
    additionalTypeDeclarations: Record<string, RawSchemas.TypeDeclarationSchema>;
}

export function convertHeader({
    header,
    schemas,
    isPackageYml,
}: {
    header: Header;
    schemas: Record<SchemaId, Schema>;
    isPackageYml: boolean;
}): ConvertedHeader {
    const typeReference = convertToTypeReference({
        schema: header.schema,
        schemas,
        prefix: isPackageYml ? undefined : ROOT_PREFIX,
    });
    const headerWithoutXPrefix = header.name.replace(/^x-|^X-/, "");
    return {
        value: {
            name: camelCase(headerWithoutXPrefix),
            docs: header.description ?? undefined,
            type: getTypeFromTypeReference(typeReference.typeReference),
        },
        additionalTypeDeclarations: typeReference.additionalTypeDeclarations,
    };
}
