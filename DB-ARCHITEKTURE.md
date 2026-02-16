# Database Architecture
University AR Exhibition Platform
Backend: Supabase (Postgres + Storage)

---

# 1. Core Concept

This system separates:

- Projects (organizational unit, QR entry point)
- Content (reusable AR scenes / models)
- Users (Supabase Auth)
- Collaborators (project permissions)
- Project ↔ Content assignment (many-to-many)

QR codes always resolve to a Project.
A Project loads its currently active Content.

---

# 2. Tables Overview

## User
- id (int8, primary key)
- name (text)
- email (text)
- created-at (timestamptz)
- role (enum userrole: user | editor | admin)

## Project

Represents an exhibition entry with a stable QR code.

- id (int8, primary key)
- title (text)
- description (text)
- status (enum project_status: draft | submitted | approved | rejected)
- created_by (int8 FK to User.id)
- created_at (timestamptz)
- qr_code (text)
- thumbnail_url (text)
- content_active (int8 FK to Content.id)
- call_to_action (int8, FK to Call_To_Action.id)

---

## Content

Reusable AR scenes or models.

- id (int8, primary key)
- name (text)
- descrition (text)
- type (enum content_type: model-3d | video | audio | image)
- template (enum content_template: simple | pedestal | cube_faces)
- file_url (text)  // Supabase Storage public URL
- thumbnail_url (text)
- created_by (int8 FK to User.id)
- created_at (timestamptz)
- updated_at (timestamptz)
- is_public (boolean)

Rules:
- Content can belong to multiple projects.
- Content can exist without being assigned to a project.
- Content is reusable across projects.

---

## Project_Contents

Join table between projects and content.

- project_id (int8 FK to Project.id, on delete cascade)
- content_id (int8 FK to content.id, on delete cascade)
- created_at (timestamptz)

Primary Key:
(project_id, content_id)

Constraints:
- A project may have multiple content items.
- Content may belong to multiple projects.

Used to:
- switch seasonal content
- maintain content history
- allow content reuse

---

## ProjectCollaborator

Join table between projects and users.

- project_id (int8 FK to Project.id, on delete cascade)
- user_id (int8 FK to User.id, on delete cascade)
- role (enum projct_role: owner | editor | viewer)
- added_at (timestamptz)

Primary Key:
(project_id, user_id)

Rules:
- Owner is stored in projects.owner_id
- Collaborators table contains editors and viewers
- A user can collaborate on multiple projects

## Call_To_Action

- id (int8, primary key)
- type (enum cta_type: link | email | phone | vCard)
- label (text)
- value (text)

---

# 3. Public AR Loading Flow

1. QR code resolves to:
   /ar/:slug

2. Query project by slug:
   select * from projects
   where slug = ?
   and status = 'approved'

3. Query active content:
   select c.*
   from content c
   join project_content pc
     on pc.content_id = c.id
   where pc.project_id = ?
   and pc.is_active = true

4. Load model_url into AR viewer.

---

# 4. Admin Portal Flow

Student:
- Creates project
- Uploads content
- Assigns content to project
- Submits for review

Editor/Admin:
- Reviews project
- Approves or rejects
- Can change active content

---
# Future Aditions

Auth System via Supabase or Keycloak