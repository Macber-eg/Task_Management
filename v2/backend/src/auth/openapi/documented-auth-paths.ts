// Generated from the previous API's committed contract (apps/docs/openapi.json).
// The /auth routes are implemented by hand-written controllers marked
// `hide: true`; their public description is kept here unchanged so clients
// and docs see the same contract. Team endpoints are not offered.
export const DOCUMENTED_AUTH_PATHS: Record<string, Record<string, unknown>> =
  {
    "/auth/get-session": {
      "get": {
        "operationId": "getSession",
        "tags": [
          "Authentication"
        ],
        "summary": "Get session",
        "description": "Get the current authenticated session, or null when the caller is not signed in. Served by Better Auth.",
        "security": [],
        "responses": {
          "200": {
            "description": "Current session details, or null when unauthenticated"
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/accept-invitation": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "acceptOrganizationInvitation",
        "summary": "Accept Organization Invitation",
        "description": "Accept an invitation to an organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "invitationId": {
                    "type": "string",
                    "description": "The ID of the invitation to accept"
                  }
                },
                "required": [
                  "invitationId"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "invitation": {
                      "type": "object",
                      "additionalProperties": {}
                    },
                    "member": {
                      "type": "object",
                      "additionalProperties": {}
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/cancel-invitation": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "cancelOrganizationInvitation",
        "summary": "Cancel Organization Invitation",
        "description": "Cancel Organization Invitation",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "invitationId": {
                    "type": "string",
                    "description": "The ID of the invitation to cancel"
                  }
                },
                "required": [
                  "invitationId"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/check-slug": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "checkOrganizationSlug",
        "summary": "Check Organization Slug",
        "description": "Check Organization Slug",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "slug": {
                    "type": "string",
                    "description": "The organization slug to check. Eg: \"my-org\""
                  }
                },
                "required": [
                  "slug"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/create": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "createOrganization",
        "summary": "Create Organization",
        "description": "Create an organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "The name of the organization"
                  },
                  "slug": {
                    "type": "string",
                    "description": "The slug of the organization"
                  },
                  "userId": {
                    "type": "string",
                    "description": "The user id of the organization creator. If not provided, the current user will be used. Should only be used by admins or when called by the server. server-only. Eg: \"user-id\""
                  },
                  "logo": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "The logo of the organization"
                  },
                  "metadata": {
                    "type": "object",
                    "additionalProperties": {},
                    "description": "The metadata of the organization"
                  },
                  "keepCurrentActiveOrganization": {
                    "type": "boolean",
                    "description": "Whether to keep the current active organization active after creating a new one. Eg: true"
                  },
                  "description": {
                    "type": [
                      "string",
                      "null"
                    ]
                  }
                },
                "required": [
                  "name",
                  "slug"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {}
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/create-role": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "createOrganizationRole",
        "summary": "Create Organization Role",
        "description": "Create Organization Role",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "organizationId": {
                    "type": "string"
                  },
                  "role": {
                    "type": "string",
                    "description": "The name of the role to create"
                  },
                  "permission": {
                    "type": "object",
                    "additionalProperties": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "description": "The permission to assign to the role"
                  },
                  "additionalFields": {
                    "type": "object",
                    "additionalProperties": {}
                  }
                },
                "required": [
                  "role",
                  "permission"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/delete": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "deleteOrganization",
        "summary": "Delete Organization",
        "description": "Delete an organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "organizationId": {
                    "type": "string",
                    "description": "The organization id to delete"
                  }
                },
                "required": [
                  "organizationId"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "string"
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/delete-role": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "deleteOrganizationRole",
        "summary": "Delete Organization Role",
        "description": "Delete Organization Role",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "allOf": [
                  {
                    "type": "object",
                    "properties": {
                      "organizationId": {
                        "type": "string"
                      }
                    }
                  },
                  {
                    "anyOf": [
                      {
                        "type": "object",
                        "properties": {
                          "roleName": {
                            "type": "string",
                            "description": "The name of the role to delete"
                          }
                        },
                        "required": [
                          "roleName"
                        ]
                      },
                      {
                        "type": "object",
                        "properties": {
                          "roleId": {
                            "type": "string",
                            "description": "The id of the role to delete"
                          }
                        },
                        "required": [
                          "roleId"
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/get-active-member": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "getOrganizationActiveMember",
        "summary": "Get Organization Active Member",
        "description": "Get the member details of the active organization",
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "userId": {
                      "type": "string"
                    },
                    "organizationId": {
                      "type": "string"
                    },
                    "role": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "id",
                    "userId",
                    "organizationId",
                    "role"
                  ]
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/get-active-member-role": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "getOrganizationActiveMemberRole",
        "summary": "Get Organization Active Member Role",
        "description": "Get Organization Active Member Role",
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/get-full-organization": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "getOrganizationFullOrganization",
        "summary": "Get Organization Full Organization",
        "description": "Get the full organization",
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {}
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/get-invitation": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "getOrganizationInvitation",
        "summary": "Get Organization Invitation",
        "description": "Get an invitation by ID",
        "parameters": [
          {
            "schema": {
              "type": "string"
            },
            "required": true,
            "name": "id",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "email": {
                      "type": "string"
                    },
                    "role": {
                      "type": "string"
                    },
                    "organizationId": {
                      "type": "string"
                    },
                    "inviterId": {
                      "type": "string"
                    },
                    "status": {
                      "type": "string"
                    },
                    "expiresAt": {
                      "type": "string"
                    },
                    "organizationName": {
                      "type": "string"
                    },
                    "organizationSlug": {
                      "type": "string"
                    },
                    "inviterEmail": {
                      "type": "string"
                    },
                    "projectAccess": {
                      "type": "string",
                      "enum": [
                        "all",
                        "selected"
                      ],
                      "description": "\"all\" gives access to every project once accepted; \"selected\" limits the member to projectIds."
                    },
                    "projectIds": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Projects the invitation grants when projectAccess is \"selected\". Only projects the viewer can access are listed."
                    }
                  },
                  "required": [
                    "id",
                    "email",
                    "role",
                    "organizationId",
                    "inviterId",
                    "status",
                    "expiresAt",
                    "organizationName",
                    "organizationSlug",
                    "inviterEmail",
                    "projectAccess",
                    "projectIds"
                  ]
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/get-role": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "getOrganizationRole",
        "summary": "Get Organization Role",
        "description": "Get Organization Role",
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/has-permission": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "hasOrganizationPermission",
        "summary": "Check Organization Permission",
        "description": "Check if the user has permission",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "permission": {
                    "type": "object",
                    "additionalProperties": {},
                    "description": "The permission to check"
                  },
                  "permissions": {
                    "type": "object",
                    "additionalProperties": {},
                    "description": "The permission to check"
                  }
                },
                "required": [
                  "permissions"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "string"
                    },
                    "success": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "success"
                  ]
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/invite-member": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "inviteOrganizationMember",
        "summary": "Invite Organization Member",
        "description": "Create or resend an invitation. Email delivery failures return 502; the invitation remains pending and can be resent after correcting SMTP settings.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "email": {
                    "type": "string",
                    "description": "The email address of the user to invite"
                  },
                  "role": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    ],
                    "description": "The role(s) to assign to the user. It can be `admin`, `member`, owner. Eg: \"member\""
                  },
                  "organizationId": {
                    "type": "string",
                    "description": "The organization ID to invite the user to"
                  },
                  "resend": {
                    "type": "boolean",
                    "description": "Resend the invitation email, if the user is already invited. Eg: true"
                  },
                  "teamId": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    ]
                  },
                  "projectAccess": {
                    "type": "string",
                    "enum": [
                      "all",
                      "selected"
                    ],
                    "description": "\"all\" (the default) gives access to every project. \"selected\" limits the new member to projectIds once they accept."
                  },
                  "projectIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "description": "Projects the new member can access when projectAccess is \"selected\". They must belong to the workspace, and an inviter whose own access is limited can only choose projects they can access."
                  }
                },
                "required": [
                  "email",
                  "role"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "email": {
                      "type": "string"
                    },
                    "role": {
                      "type": "string"
                    },
                    "organizationId": {
                      "type": "string"
                    },
                    "inviterId": {
                      "type": "string"
                    },
                    "status": {
                      "type": "string"
                    },
                    "expiresAt": {
                      "type": "string"
                    },
                    "createdAt": {
                      "type": "string"
                    },
                    "projectAccess": {
                      "type": "string",
                      "enum": [
                        "all",
                        "selected"
                      ],
                      "description": "\"all\" gives access to every project once accepted; \"selected\" limits the member to projectIds."
                    },
                    "projectIds": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Projects the invitation grants when projectAccess is \"selected\". Only projects the viewer can access are listed."
                    }
                  },
                  "required": [
                    "id",
                    "email",
                    "role",
                    "organizationId",
                    "inviterId",
                    "status",
                    "expiresAt",
                    "createdAt",
                    "projectAccess",
                    "projectIds"
                  ]
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          },
          "502": {
            "description": "Invitation saved, but email delivery failed",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "string",
                      "enum": [
                        "INVITATION_EMAIL_FAILED"
                      ]
                    },
                    "message": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "code",
                    "message"
                  ]
                }
              }
            }
          }
        }
      }
    },
    "/auth/organization/leave": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "leaveOrganization",
        "summary": "Leave Organization",
        "description": "Leave Organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "organizationId": {
                    "type": "string",
                    "description": "The organization Id for the member to leave. Eg: \"organization-id\""
                  }
                },
                "required": [
                  "organizationId"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/list": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "listOrganization",
        "summary": "List Organization",
        "description": "List all organizations",
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {}
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/list-invitations": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "listOrganizationInvitations",
        "summary": "List Organization Invitations",
        "description": "List Organization Invitations",
        "parameters": [
          {
            "schema": {
              "type": "string"
            },
            "required": false,
            "name": "organizationId",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "email": {
                        "type": "string"
                      },
                      "role": {
                        "type": "string"
                      },
                      "organizationId": {
                        "type": "string"
                      },
                      "inviterId": {
                        "type": "string"
                      },
                      "status": {
                        "type": "string"
                      },
                      "expiresAt": {
                        "type": "string"
                      },
                      "createdAt": {
                        "type": "string"
                      },
                      "projectAccess": {
                        "type": "string",
                        "enum": [
                          "all",
                          "selected"
                        ],
                        "description": "\"all\" gives access to every project once accepted; \"selected\" limits the member to projectIds."
                      },
                      "projectIds": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        },
                        "description": "Projects the invitation grants when projectAccess is \"selected\". Only projects the viewer can access are listed."
                      }
                    },
                    "required": [
                      "id",
                      "email",
                      "role",
                      "organizationId",
                      "inviterId",
                      "status",
                      "expiresAt",
                      "createdAt",
                      "projectAccess",
                      "projectIds"
                    ]
                  }
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/list-members": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "listOrganizationMembers",
        "summary": "List Organization Members",
        "description": "List Organization Members",
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/list-roles": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "listOrganizationRoles",
        "summary": "List Organization Roles",
        "description": "List Organization Roles",
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/list-user-invitations": {
      "get": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "listOrganizationUserInvitations",
        "summary": "List Organization User Invitations",
        "description": "List all invitations a user has received",
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "email": {
                        "type": "string"
                      },
                      "role": {
                        "type": "string"
                      },
                      "organizationId": {
                        "type": "string"
                      },
                      "organizationName": {
                        "type": "string"
                      },
                      "inviterId": {
                        "type": "string",
                        "description": "The ID of the user who created the invitation"
                      },
                      "teamId": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "description": "The ID of the team associated with the invitation"
                      },
                      "status": {
                        "type": "string"
                      },
                      "expiresAt": {
                        "type": "string"
                      },
                      "createdAt": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "email",
                      "role",
                      "organizationId",
                      "organizationName",
                      "inviterId",
                      "status",
                      "expiresAt",
                      "createdAt"
                    ]
                  }
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/reject-invitation": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "rejectOrganizationInvitation",
        "summary": "Reject Organization Invitation",
        "description": "Reject an invitation to an organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "invitationId": {
                    "type": "string",
                    "description": "The ID of the invitation to reject"
                  }
                },
                "required": [
                  "invitationId"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "invitation": {
                      "type": "object",
                      "additionalProperties": {}
                    },
                    "member": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "additionalProperties": {}
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/remove-member": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "removeOrganizationMember",
        "summary": "Remove Organization Member",
        "description": "Remove a member from an organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "memberIdOrEmail": {
                    "type": "string",
                    "description": "The ID or email of the member to remove"
                  },
                  "organizationId": {
                    "type": "string",
                    "description": "The ID of the organization to remove the member from. If not provided, the active organization will be used. Eg: \"org-id\""
                  }
                },
                "required": [
                  "memberIdOrEmail"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "member": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string"
                        },
                        "userId": {
                          "type": "string"
                        },
                        "organizationId": {
                          "type": "string"
                        },
                        "role": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "id",
                        "userId",
                        "organizationId",
                        "role"
                      ]
                    }
                  },
                  "required": [
                    "member"
                  ]
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/set-active": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "setOrganizationActive",
        "summary": "Set Organization Active",
        "description": "Set the active organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "organizationId": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "The organization id to set as active. It can be null to unset the active organization. Eg: \"org-id\""
                  },
                  "organizationSlug": {
                    "type": "string",
                    "description": "The organization slug to set as active. It can be null to unset the active organization if organizationId is not provided. Eg: \"org-slug\""
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {}
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/update": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "updateOrganization",
        "summary": "Update Organization",
        "description": "Update an organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "data": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "name": {
                        "type": "string",
                        "description": "The name of the organization"
                      },
                      "slug": {
                        "type": "string",
                        "description": "The slug of the organization"
                      },
                      "logo": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "description": "The logo of the organization"
                      },
                      "metadata": {
                        "type": "object",
                        "additionalProperties": {},
                        "description": "The metadata of the organization"
                      }
                    }
                  },
                  "organizationId": {
                    "type": "string",
                    "description": "The organization ID. Eg: \"org-id\""
                  }
                },
                "required": [
                  "data"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {}
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/update-member-role": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "updateOrganizationMemberRole",
        "summary": "Update Organization Member Role",
        "description": "Update the role of a member in an organization",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "role": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    ],
                    "description": "The new role to be applied. This can be a string or array of strings representing the roles. Eg: [\"admin\", \"sale\"]"
                  },
                  "memberId": {
                    "type": "string",
                    "description": "The member id to apply the role update to. Eg: \"member-id\""
                  },
                  "organizationId": {
                    "type": "string",
                    "description": "An optional organization ID which the member is a part of to apply the role update. If not provided, you must provide session headers to get the active organization. Eg: \"organization-id\""
                  }
                },
                "required": [
                  "role",
                  "memberId"
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "member": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string"
                        },
                        "userId": {
                          "type": "string"
                        },
                        "organizationId": {
                          "type": "string"
                        },
                        "role": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "id",
                        "userId",
                        "organizationId",
                        "role"
                      ]
                    }
                  },
                  "required": [
                    "member"
                  ]
                }
              }
            }
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/organization/update-role": {
      "post": {
        "tags": [
          "Organization Management"
        ],
        "operationId": "updateOrganizationRole",
        "summary": "Update Organization Role",
        "description": "Update Organization Role",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "allOf": [
                  {
                    "type": "object",
                    "properties": {
                      "organizationId": {
                        "type": "string"
                      },
                      "data": {
                        "type": "object",
                        "properties": {
                          "permission": {
                            "type": "object",
                            "additionalProperties": {
                              "type": "array",
                              "items": {
                                "type": "string"
                              }
                            }
                          },
                          "roleName": {
                            "type": "string"
                          }
                        }
                      }
                    },
                    "required": [
                      "data"
                    ]
                  },
                  {
                    "anyOf": [
                      {
                        "type": "object",
                        "properties": {
                          "roleName": {
                            "type": "string",
                            "description": "The name of the role to update"
                          }
                        },
                        "required": [
                          "roleName"
                        ]
                      },
                      {
                        "type": "object",
                        "properties": {
                          "roleId": {
                            "type": "string",
                            "description": "The id of the role to update"
                          }
                        },
                        "required": [
                          "roleId"
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success"
          },
          "401": {
            "description": "Missing or invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    },
    "/auth/device": {
      "get": {
        "operationId": "getDeviceAuthorizationPage",
        "tags": [
          "Authentication"
        ],
        "summary": "Device authorization page",
        "description": "Better Auth serves this as JSON. A top-level browser navigation is redirected to the web app's device screen instead, so opening the URL by hand shows a page rather than a JSON blob.",
        "security": [],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "description": "The device authorization user code."
            },
            "required": false,
            "description": "The device authorization user code.",
            "name": "user_code",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "enum": [
                "1"
              ],
              "description": "Force a redirect to the web UI, for clients that do not send Sec-Fetch-* headers."
            },
            "required": false,
            "description": "Force a redirect to the web UI, for clients that do not send Sec-Fetch-* headers.",
            "name": "ui",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "Device authorization payload from Better Auth"
          },
          "302": {
            "description": "Redirects the browser to the web app device screen"
          },
          "429": {
            "$ref": "#/components/responses/ApiKeyRateLimited"
          }
        }
      }
    }
  };
