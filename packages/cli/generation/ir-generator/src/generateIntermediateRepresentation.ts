import { Audiences } from "@fern-api/config-management-commons";
import { noop, visitObject } from "@fern-api/core-utils";
import { dirname, join, RelativeFilePath } from "@fern-api/fs-utils";
import { GenerationLanguage } from "@fern-api/generators-configuration";
import { FERN_PACKAGE_MARKER_FILENAME } from "@fern-api/project-configuration";
import { FernWorkspace, visitAllDefinitionFiles, visitAllPackageMarkers } from "@fern-api/workspace-loader";
import { ServiceId, TypeId } from "@fern-fern/ir-model/commons";
import { HttpEndpoint, PathParameterLocation, ResponseErrors } from "@fern-fern/ir-model/http";
import { IntermediateRepresentation, ServiceTypeReferenceInfo } from "@fern-fern/ir-model/ir";
import { mapValues, pickBy } from "lodash-es";
import { constructCasingsGenerator } from "./casings/CasingsGenerator";
import { generateFernConstants } from "./converters/constants";
import { convertApiAuth } from "./converters/convertApiAuth";
import { getAudiences } from "./converters/convertDeclaration";
import { convertEnvironments } from "./converters/convertEnvironments";
import { convertErrorDeclaration } from "./converters/convertErrorDeclaration";
import { convertErrorDiscriminationStrategy } from "./converters/convertErrorDiscriminationStrategy";
import { constructHttpPath } from "./converters/services/constructHttpPath";
import { convertHttpHeader, convertHttpService, convertPathParameters } from "./converters/services/convertHttpService";
import { convertTypeDeclaration } from "./converters/type-declarations/convertTypeDeclaration";
import { constructFernFileContext, constructRootApiFileContext, FernFileContext } from "./FernFileContext";
import { FilteredIr } from "./filtered-ir/FilteredIr";
import { IrGraph } from "./filtered-ir/IrGraph";
import { IdGenerator } from "./IdGenerator";
import { PackageTreeGenerator } from "./PackageTreeGenerator";
import { ErrorResolverImpl } from "./resolvers/ErrorResolver";
import { ExampleResolverImpl } from "./resolvers/ExampleResolver";
import { TypeResolverImpl } from "./resolvers/TypeResolver";
import { VariableResolverImpl } from "./resolvers/VariableResolver";
import { convertToFernFilepath } from "./utils/convertToFernFilepath";
import { parseErrorName } from "./utils/parseErrorName";

export async function generateIntermediateRepresentation({
    workspace,
    generationLanguage,
    audiences,
}: {
    workspace: FernWorkspace;
    generationLanguage: GenerationLanguage | undefined;
    audiences: Audiences;
}): Promise<IntermediateRepresentation> {
    const casingsGenerator = constructCasingsGenerator(generationLanguage);

    const irGraph = new IrGraph(audiences);

    const rootApiFileContext = constructRootApiFileContext({
        casingsGenerator,
        rootApiFile: workspace.definition.rootApiFile.contents,
    });
    const globalErrors: ResponseErrors = (workspace.definition.rootApiFile.contents.errors ?? []).map(
        (referenceToError) => {
            const errorName = parseErrorName({
                errorName: referenceToError,
                file: rootApiFileContext,
            });
            return { error: errorName, docs: undefined };
        }
    );

    const typeResolver = new TypeResolverImpl(workspace);
    const errorResolver = new ErrorResolverImpl(workspace);
    const exampleResolver = new ExampleResolverImpl(typeResolver);
    const variableResolver = new VariableResolverImpl();

    const intermediateRepresentation: Omit<IntermediateRepresentation, "sdkConfig" | "subpackages" | "rootPackage"> = {
        apiName: casingsGenerator.generateName(workspace.name),
        apiDisplayName: workspace.definition.rootApiFile.contents["display-name"],
        apiDocs: workspace.definition.rootApiFile.contents.docs,
        auth: convertApiAuth({
            rawApiFileSchema: workspace.definition.rootApiFile.contents,
            file: rootApiFileContext,
        }),
        headers:
            workspace.definition.rootApiFile.contents.headers != null
                ? Object.entries(workspace.definition.rootApiFile.contents.headers).map(([headerKey, header]) =>
                      convertHttpHeader({ headerKey, header, file: rootApiFileContext })
                  )
                : [],
        types: {},
        errors: {},
        services: {},
        constants: generateFernConstants(casingsGenerator),
        environments: convertEnvironments({
            casingsGenerator,
            rawApiFileSchema: workspace.definition.rootApiFile.contents,
        }),
        errorDiscriminationStrategy: convertErrorDiscriminationStrategy(
            workspace.definition.rootApiFile.contents["error-discrimination"],
            rootApiFileContext
        ),
        basePath:
            workspace.definition.rootApiFile.contents["base-path"] != null
                ? constructHttpPath(workspace.definition.rootApiFile.contents["base-path"])
                : undefined,
        pathParameters: convertPathParameters({
            pathParameters: workspace.definition.rootApiFile.contents["path-parameters"],
            file: rootApiFileContext,
            location: PathParameterLocation.Root,
            variableResolver,
        }),
        variables:
            workspace.definition.rootApiFile.contents.variables != null
                ? Object.entries(workspace.definition.rootApiFile.contents.variables).map(([key, variable]) => ({
                      docs: typeof variable !== "string" ? variable.docs : undefined,
                      id: key,
                      name: rootApiFileContext.casingsGenerator.generateName(key),
                      type: rootApiFileContext.parseTypeReference(variable),
                  }))
                : [],
        serviceTypeReferenceInfo: {
            typesReferencedOnlyByService: {},
            sharedTypes: [],
        },
    };

    const packageTreeGenerator = new PackageTreeGenerator();

    const visitDefinitionFile = async (file: FernFileContext) => {
        packageTreeGenerator.addSubpackage(file.fernFilepath);

        await visitObject(file.definitionFile, {
            imports: noop,
            docs: (docs) => {
                if (docs != null) {
                    packageTreeGenerator.addDocs(file.fernFilepath, docs);
                }
            },

            types: (types) => {
                if (types == null) {
                    return;
                }

                for (const [typeName, typeDeclaration] of Object.entries(types)) {
                    const convertedTypeDeclaration = convertTypeDeclaration({
                        typeName,
                        typeDeclaration,
                        file,
                        typeResolver,
                        exampleResolver,
                    });

                    const typeId = IdGenerator.generateTypeId(convertedTypeDeclaration.name);
                    intermediateRepresentation.types[typeId] = convertedTypeDeclaration;
                    packageTreeGenerator.addType(typeId, convertedTypeDeclaration);

                    irGraph.addType(convertedTypeDeclaration.name, convertedTypeDeclaration.referencedTypes);
                    irGraph.markTypeForAudiences(convertedTypeDeclaration.name, getAudiences(typeDeclaration));
                }
            },

            errors: (errors) => {
                if (errors == null) {
                    return;
                }
                const errorDiscriminationSchema = workspace.definition.rootApiFile.contents["error-discrimination"];
                if (errorDiscriminationSchema == null) {
                    throw new Error("error-discrimination is missing in api.yml but there are declared errors.");
                }
                for (const [errorName, errorDeclaration] of Object.entries(errors)) {
                    const convertedErrorDeclaration = convertErrorDeclaration({
                        errorName,
                        errorDeclaration,
                        file,
                    });

                    const errorId = IdGenerator.generateErrorId(convertedErrorDeclaration.name);
                    intermediateRepresentation.errors[errorId] = convertedErrorDeclaration;
                    packageTreeGenerator.addError(errorId, convertedErrorDeclaration);

                    irGraph.addError(convertedErrorDeclaration);
                }
            },

            service: (service) => {
                if (service == null) {
                    return;
                }

                const convertedHttpService = convertHttpService({
                    rootPathParameters: intermediateRepresentation.pathParameters,
                    serviceDefinition: service,
                    file,
                    errorResolver,
                    typeResolver,
                    exampleResolver,
                    globalErrors,
                    variableResolver,
                });

                const serviceId = IdGenerator.generateServiceId(convertedHttpService.name);
                intermediateRepresentation.services[serviceId] = convertedHttpService;
                packageTreeGenerator.addService(serviceId, convertedHttpService);

                const convertedEndpoints: Record<string, HttpEndpoint> = {};
                convertedHttpService.endpoints.forEach((httpEndpoint) => {
                    irGraph.addEndpoint(convertedHttpService, httpEndpoint);
                    convertedEndpoints[httpEndpoint.name.originalName] = httpEndpoint;
                });
                if (service.audiences != null) {
                    irGraph.markEndpointForAudience(
                        convertedHttpService.name,
                        convertedHttpService.endpoints,
                        service.audiences
                    );
                }
                Object.entries(service.endpoints).map(([endpointId, endpoint]) => {
                    const convertedEndpoint = convertedEndpoints[endpointId];
                    if (convertedEndpoint != null && endpoint.audiences != null) {
                        irGraph.markEndpointForAudience(
                            convertedHttpService.name,
                            [convertedEndpoint],
                            endpoint.audiences
                        );
                    }
                });
            },
        });
    };

    await visitAllDefinitionFiles(workspace, async (relativeFilepath, file) => {
        await visitDefinitionFile(
            constructFernFileContext({
                relativeFilepath,
                definitionFile: file,
                casingsGenerator,
                rootApiFile: workspace.definition.rootApiFile.contents,
            })
        );
    });

    await visitAllPackageMarkers(workspace, async (relativeFilepath, packageMarker) => {
        if (packageMarker.navigation == null) {
            return;
        }

        if (typeof packageMarker.navigation === "string") {
            packageTreeGenerator.addPackageRedirection({
                from: convertToFernFilepath({ relativeFilepath, casingsGenerator }),
                to: convertToFernFilepath({
                    relativeFilepath: join(dirname(relativeFilepath), RelativeFilePath.of(packageMarker.navigation)),
                    casingsGenerator,
                }),
            });
        } else {
            const childrenInOrder = packageMarker.navigation.map((childFilepath) => {
                return IdGenerator.generateSubpackageId(
                    convertToFernFilepath({
                        relativeFilepath: join(dirname(relativeFilepath), RelativeFilePath.of(childFilepath)),
                        casingsGenerator,
                    })
                );
            });

            if (relativeFilepath === FERN_PACKAGE_MARKER_FILENAME) {
                packageTreeGenerator.sortRootPackage(childrenInOrder);
            } else {
                packageTreeGenerator.sortSubpackage(
                    IdGenerator.generateSubpackageId(
                        convertToFernFilepath({
                            relativeFilepath,
                            casingsGenerator,
                        })
                    ),
                    childrenInOrder
                );
            }
        }
    });

    intermediateRepresentation.serviceTypeReferenceInfo = computeServiceTypeReferenceInfo(irGraph);

    const filteredIr = !irGraph.hasNoAudiences() ? irGraph.build() : undefined;
    const intermediateRepresentationForAudiences = filterIntermediateRepresentationForAudiences(
        intermediateRepresentation,
        filteredIr
    );

    const isAuthMandatory =
        workspace.definition.rootApiFile.contents.auth != null &&
        Object.values(intermediateRepresentationForAudiences.services).every((service) => {
            return service.endpoints.every((endpoint) => endpoint.auth);
        });

    const hasStreamingEndpoints = Object.values(intermediateRepresentationForAudiences.services).some((service) => {
        return service.endpoints.some((endpoint) => endpoint.response?.type === "streaming");
    });

    const hasFileDownloadEndpoints = Object.values(intermediateRepresentationForAudiences.services).some((service) => {
        return service.endpoints.some((endpoint) => endpoint.response?.type === "fileDownload");
    });

    return {
        ...intermediateRepresentationForAudiences,
        ...packageTreeGenerator.build(filteredIr),
        sdkConfig: {
            isAuthMandatory,
            hasStreamingEndpoints,
            hasFileDownloadEndpoints,
            platformHeaders: {
                language: "X-Fern-Language",
                sdkName: "X-Fern-SDK-Name",
                sdkVersion: "X-Fern-SDK-Version",
            },
        },
    };
}

function computeServiceTypeReferenceInfo(irGraph: IrGraph): ServiceTypeReferenceInfo {
    const typesReferencedOnlyByService: Record<ServiceId, TypeId[]> = {};
    const sharedTypes: TypeId[] = [];
    const typesReferencedByService = irGraph.getTypesReferencedByService();
    for (const [typeId, serviceIds] of Object.entries(typesReferencedByService)) {
        if (serviceIds.size === 1) {
            const serviceId = serviceIds.values().next().value;
            if (typesReferencedOnlyByService[serviceId] === undefined) {
                typesReferencedOnlyByService[serviceId] = [];
            }
            typesReferencedOnlyByService[serviceId]?.push(typeId);
            continue;
        }
        sharedTypes.push(typeId);
    }
    return {
        typesReferencedOnlyByService,
        sharedTypes,
    };
}

function filterIntermediateRepresentationForAudiences(
    intermediateRepresentation: Omit<IntermediateRepresentation, "sdkConfig" | "subpackages" | "rootPackage">,
    filteredIr: FilteredIr | undefined
): Omit<IntermediateRepresentation, "sdkConfig" | "subpackages" | "rootPackage"> {
    if (filteredIr == null) {
        return intermediateRepresentation;
    }
    return {
        ...intermediateRepresentation,
        types: pickBy(intermediateRepresentation.types, (type) => filteredIr.hasType(type)),
        errors: pickBy(intermediateRepresentation.errors, (error) => filteredIr.hasError(error)),
        services: mapValues(
            pickBy(intermediateRepresentation.services, (httpService) => filteredIr.hasService(httpService)),
            (httpService) => ({
                ...httpService,
                endpoints: httpService.endpoints.filter((httpEndpoint) =>
                    filteredIr.hasEndpoint(httpService, httpEndpoint)
                ),
            })
        ),
    };
}
