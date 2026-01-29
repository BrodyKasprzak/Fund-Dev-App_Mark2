// lib/handbookTemplates.ts

export type HandbookQuestion = {
  id: string;
  label: string;
  helper?: string;
  placeholder?: string;
  type?: "text" | "textarea" | "select" | "multiselect";
  options?: string[];
  required?: boolean;
};

export const BASE_TEMPLATES: Record<string, string> = {
  s1_intro: `This Fund Development Handbook relates to common fund development and fundraising practices and serves as the governing document for all fundraising activities of [Organization Name]. This handbook is a dynamic document and should be revised and updated as necessary.

Fund Development is the strategic process by which nonprofits plan and implement fundraising activities to secure the financial resources necessary to carry out their mission. Fundraising is the act of seeking financial support through organized activity or solicitation of donations or pledges. The purpose of this handbook is to ensure consistent policies, procedures, and practices that strengthen organizational capacity and promote ethical, legal, and effective fundraising.

This handbook should increase [Organization Name]’s capacity to implement a strategic fund development program. When a policy or procedure is adopted or revised by the Board of Directors, the date should be recorded and the information updated in this document.`,

  s2_philosophy: `A constituent is defined as an individual, family unit, business, corporation, foundation, or other party that contributes or may contribute financial or in-kind support, or otherwise demonstrates interest in [Organization Name]’s mission.

Donor cultivation is the process of building relationships with prospective or current donors and nurturing them toward deeper engagement and commitment. Donor stewardship is the ongoing process of thanking donors, demonstrating impact, maintaining transparency, and strengthening long-term relationships. Donor retention measures how many donors continue giving year over year and is a key indicator of fundraising effectiveness.`,

  s3_roles: `Board of Directors

The Board of Directors exercises the duties of care, loyalty, and obedience. Board members approve fundraising policies (but not procedures), review and approve the annual budget, review the IRS Form 990 prior to submission, and ensure compliance with all applicable laws and regulations. Board members are expected to make at least one meaningful financial contribution to [Organization Name] every twelve months and to serve as ambassadors for the organization.

Executive Director

The Executive Director leads the fund development program, including strategic donor acquisition, cultivation, and retention. The Executive Director oversees fundraising staff, approves solicitations and major gifts, ensures compliance with this handbook, and maintains key donor and funder relationships.

Development and Operations Staff

Development and operations staff are responsible for gift processing, donor recognition, CRM management, grant tracking, reporting, and implementation of fundraising procedures outlined in this handbook.`,

  s4_ethics: `Donor Bill of Rights

[Organization Name] adopts and adheres to the Donor Bill of Rights developed by the Association of Fundraising Professionals and partner organizations. Donors have the right to be informed of the organization’s mission and use of donated funds; to access financial information; to receive appropriate acknowledgment; to have their information handled confidentially; to know whether solicitors are volunteers or staff; and to expect truthful, professional communication at all times.

Ethical & Truthful Solicitations

All fundraising solicitations must be honest, accurate, and transparent. [Organization Name] will clearly communicate how funds will be used, avoid exaggeration or misleading statements, and make financial information such as annual reports and IRS Form 990 publicly available.

Consent Policy for Beneficiary Storytelling

When sharing stories or images of beneficiaries, [Organization Name] will obtain informed consent using written consent forms. Storytelling will be respectful, accurate, and dignified, avoiding exploitation or misrepresentation.`,

  s5_gift_acceptance: `Policy Statement

[Organization Name] accepts gifts in a manner consistent with its mission, governing documents, and ethical standards. This Gift Acceptance Policy guides staff and Board members regarding which gifts may be accepted without review, which require review by the Executive Committee or Board of Directors (and legal counsel when appropriate), and which gifts the organization is not positioned to accept.

Guiding Principles

[Organization Name] holds itself to a high standard of ethical conduct and will not accept gifts that compromise its mission, public trust, or legal standing. Donors are encouraged to seek independent legal and financial advice. The organization reserves the right to seek legal counsel for complex or nonstandard gifts and generally does not serve as trustee for deferred gifts.

Types of Gifts Accepted

Accepted gifts include cash (checks, electronic transfers, credit cards), publicly traded securities, cryptocurrency, real property, tangible and intangible personal property, planned gifts, bargain sales, restricted and unrestricted gifts, gifts in honor or memory of individuals, and in-kind gifts. Certain gifts, including real property, remainder interests, restricted gifts with significant limitations, and complex planned gifts require Executive Committee and/or Board approval.

Publicly traded securities and cryptocurrency are generally liquidated upon receipt unless otherwise directed by the Executive Committee. Real property gifts undergo due diligence including marketability review, cost analysis, environmental inspection, and title verification, with associated costs generally borne by the donor.

Restricted and Unrestricted Gifts

Restricted gifts impose a legal obligation on [Organization Name] and are reviewed to ensure feasibility and alignment with mission. If restrictions are deemed overly burdensome, donors may be asked to modify terms or the gift may be declined. Unrestricted gifts are allocated according to established approval thresholds.

Gifts Not Accepted

[Organization Name] reserves the right to decline gifts that conflict with its mission, bylaws, or tax-exempt status; are too costly or complex to administer; expose the organization to legal or environmental risk; or result in unacceptable consequences.

Review and Approval

This policy is reviewed annually by the Executive Committee or Board of Directors and updated as needed.`,

  s5a_major_gifts: `Policy Statement

[Organization Name] welcomes major gifts that advance its mission and long-term sustainability. Major gifts are accepted and stewarded in accordance with this Gift Acceptance Policy (Section 5) and the additional guidance set forth in this section.

Definition of a Major Gift

A major gift is defined as any contribution, cash or non-cash, that meets or exceeds a threshold determined by the organization based on its size, fundraising strategy, and donor behavior.

For many organizations, a major gift is defined as a contribution of $5,000 or more; however, [Organization Name] may adjust this threshold periodically.

Guiding Principles

Major gifts are governed by the same ethical standards, mission alignment requirements, and donor-centered principles that apply to all other types of gifts, as outlined in Section 5: Gift Acceptance Policy.

Authority and Review

Major gifts are solicited, reviewed, and accepted following the same approval authorities and review processes established for all other types of gifts, as defined in Section 5.

Where a proposed major gift involves unusual restrictions, long-term obligations, naming considerations, or heightened risk, additional review by the Executive Committee, Board of Directors, or legal counsel may be required, consistent with Section 5.

Types of Major Gifts

Major gifts may include cash, securities, donor-advised fund distributions, cryptocurrency, restricted or unrestricted gifts, pledges, planned gifts, and major in-kind contributions, subject to the same acceptance standards and due diligence applied to all other gift types under Section 5.

Restricted Major Gifts

Restricted major gifts are evaluated, documented, and managed using the same criteria, review standards, and donor intent safeguards applied to all other restricted gifts, as described in Section 5.

Pledges and Commitments

Pledges, including multi-year commitments, binding pledges, conditional pledges, and non-binding statements of intent, are handled in accordance with the same policies and accounting standards that apply to all other pledge commitments, as outlined in Section 5 and related financial management policies.

Due Diligence

Major gifts are subject to the same due diligence, risk assessment, and ethical review processes required for all other types of gifts, as established in Section 5. The organization reserves the right to conduct additional review when gift size, complexity, or reputational considerations warrant.

Documentation and Recordkeeping

All major gifts are documented in the CRM and organizational records using the same documentation, recordkeeping, and data management standards applied to all other gifts, consistent with Section 5 and Section 6: Gift Processing Policies and Procedures.

Stewardship and Recognition

Major donors receive stewardship and recognition consistent with the organization’s Donor Recognition and Acknowledgement and Donor Cultivation and Stewardship policies. Enhanced stewardship may be provided based on gift significance and donor preference, using the same guiding principles applied to all donors.

Review and Approval

This Major Gifts Acceptance Policy is reviewed annually and updated as needed, in coordination with the Gift Acceptance Policy (Section 5), to ensure consistency and alignment with organizational practices.`,

  s6_processing: `Policy Statement

[Organization Name] is committed to accurate, timely, secure, and transparent processing of all gifts. Strong internal controls, separation of duties, and consistent procedures are maintained to safeguard assets, ensure compliance with IRS and accounting requirements, and promote donor trust.

Purpose

[Organization Name] receives donations through multiple channels. To ensure accurate donation processing, donor recognition, and financial accountability, all staff members follow standardized procedures and arrange appropriate coverage when staff are absent.

Definitions

CRM (Constituent Relationship Management System): The primary system used to track donor records, gifts, actions, and relationships.

Constituent: An individual, family, business, foundation, or other entity that contributes or may contribute to [Organization Name].

Cash Controls / Internal Controls: Policies and procedures designed to protect assets, prevent fraud, and ensure accurate financial reporting.

Donor-Advised Fund (DAF): A charitable giving account established at a public charity or financial institution.

GAAP: Generally Accepted Accounting Principles governing financial reporting.

Soft Credit: Recognition given to an individual who influenced or facilitated a gift but was not the direct donor.

Qualified Charitable Distribution (QCD): A distribution from a retirement account made directly to a qualified charity.

Roles and Responsibilities

The Director of Operations and the Office Manager share oversight responsibility for gift processing. The Office Manager manages day-to-day processing, documentation, deposits, and data entry. The Director of Operations provides oversight through periodic review of records, reconciliations, and adherence to procedures. Questions or discrepancies are addressed collaboratively and promptly.

Internal Controls and Safeguards

At least two staff members participate in verification of deposits whenever possible.

Checks and cash are stored in locked locations until deposit.

Deposits are reconciled against CRM records and bank statements.

Access to donation platforms and financial systems is password-protected and limited to authorized staff.

Donation processing follows a documented chain of custody.

Gift Processing Procedures by Gift Type

Electronic and Online Gifts

Online donations processed through 3rd parties are deposited directly into [Organization Name]’s bank account. Staff access platform reports to verify deposits and manually record gifts in the CRM, including donation amount, date, campaign, and purpose. Soft credits are recorded when gifts are processed through third-party entities.

Gifts from Third-Party Platforms

When gifts are processed through third-party platforms such as donor-advised funds, corporate giving portals, or community foundations, donors receive receipts from those platforms. [Organization Name] does not issue duplicate tax receipts but sends a personalized thank-you communication acknowledging the gift.

Grants and Foundation Payments

Grant payments are recorded in the CRM under the appropriate constituent record. When a grant award includes reporting requirements, report deadlines are entered as tasks in the CRM and shared with all staff involved in program implementation.

Checks and Cash Gifts

Mail is opened daily by designated staff in a shared workspace. Checks and cash are placed in alphabetical order, secured in a locked bag or safe, and deposited promptly. Adding machine tapes or deposit summaries are prepared and signed by two staff members when feasible. All checks are endorsed using a deposit-only stamp.

Correspondence accompanying donations is scanned and stored electronically. Gifts designated as “in honor of” or “in memory of” are flagged and processed according to donor recognition procedures.

Qualified Charitable Distributions (QCDs)

QCDs are recorded as gifts but do not receive tax receipts from [Organization Name], as the donor receives documentation from the retirement account administrator. Donors receive a personalized thank-you note, and leadership may follow up with a phone call.

Securities and Cryptocurrency

When a donor expresses interest in donating securities or cryptocurrency, staff coordinate a warm handoff to the organization’s designated financial advisor or broker. Securities and cryptocurrency are generally liquidated promptly unless otherwise directed. Staff confirm receipt and record gift details in the CRM, including date, type, and valuation method.

Other and Emerging Gift Types

As new giving methods arise, processing procedures will be documented and added to this handbook to ensure consistency and accountability.

Data Entry and Recordkeeping

Minimum required donor information includes donor name, email address, donation amount, date, and purpose. Additional information is collected when available to support stewardship and data hygiene. Business and foundation records include primary contacts and contact details.

All gifts are entered into the CRM promptly. Actions related to gift solicitation, acknowledgment, and stewardship are recorded to create a complete donor history.

Documentation and References

Sample gift receipts

IRS donation receipt requirements

Approved thank-you letter templates

Review and Approval

Gift Processing Policies and Procedures are reviewed annually by senior staff and updated as needed to maintain compliance and best practices.`,

  s7_recognition: `Policy Statement

[Organization Name] recognizes and honors all donors in a timely, respectful, and compliant manner. Donor recognition practices are designed to demonstrate gratitude, strengthen relationships, uphold donor intent and privacy, and comply with federal and state regulations.

Purpose

The purpose of donor recognition is to acknowledge contributions appropriately while fostering long-term donor relationships. Recognition activities support donor retention, stewardship, and trust, and ensure compliance with IRS receipting requirements.

Definitions

Receipt: A written acknowledgment that meets IRS requirements for substantiating charitable contributions.

Thank You: An expression of appreciation that may take the form of a letter, email, phone call, handwritten note, or other personal communication.

In Honor Of (IHO) / In Memory Of (IMO): Gifts made to recognize or memorialize an individual.

Colorado Privacy Act (CPA) / Consumer Data Privacy Laws: Laws granting donors rights related to access, correction, deletion, and opt-out of communications involving personal data.

Roles and Responsibilities

The Office Manager is responsible for generating receipts and initiating standard donor acknowledgments. The Executive Director is responsible for personal outreach, including phone calls, handwritten notes, and relationship-building communications. All staff and Board members share responsibility for showing appreciation and professionalism toward donors.

Donor Privacy and Preferences

[Organization Name] protects donor information and respects donor communication preferences. Donors may request anonymity, opt out of communications, or request changes to their contact information at any time. Donor data is handled confidentially and in accordance with applicable privacy laws.

Donor Recognition Procedures

Gifts Processed by Third Parties

When donations are made through third-party platforms such as donor-advised funds, community foundations, corporate giving portals, or social media platforms, donors receive tax receipts directly from the third party. [Organization Name] does not issue duplicate receipts but sends a personalized thank-you communication acknowledging the gift.

For one-time donations, a customized thank-you letter is prepared for Executive Director signature. For recurring donations, a thank-you email is sent at the start of the recurring gift.

Annual giving summaries may be sent as a courtesy but are not required by the IRS.

Gifts from Individuals, Grantors, and Contractors

All direct donations, including grants, checks, cash, and electronic transfers, receive a receipt or combined receipt/thank-you letter. For first-time donors, additional information such as an annual report or impact summary may be included.

For contract payments, acknowledgments are optional but may be sent as a courtesy.

In Honor Of / In Memory Of Gifts

Gifts designated in honor or memory of an individual are recorded accordingly in the CRM. Donors receive standard acknowledgment, and honorees or family members receive notification without disclosure of gift amounts unless authorized.

Cash, Check, and Retirement Account Gifts

All cash and check donations receive receipts generated through the CRM. Donations exceeding established thresholds may receive enhanced recognition, including personalized letters or phone calls. Qualified Charitable Distributions do not receive tax receipts from [Organization Name], as documentation is provided by the account administrator.

Securities and Cryptocurrency Gifts

Donations of securities or cryptocurrency receive written acknowledgment that includes the date of donation, type of asset, and valuation method consistent with IRS guidance. Donors are thanked personally by leadership.

IRS Receipt Requirements

Donation receipts issued by [Organization Name] include:
- Legal name of the organization
- Statement of 501(c)(3) tax-exempt status
- Donor name
- Date of contribution
- Amount of cash contribution or description (but not value) of non-cash contributions
- Statement regarding goods or services provided in exchange for the gift, if applicable

Receipts are issued contemporaneously as required by the IRS.

Recognition Escalation and Special Actions

Special recognition actions may be triggered for:
- First-time donors
- Cumulative giving milestones
- Consecutive years of giving
- Major or transformational gifts

Actions may include phone calls, handwritten notes, Board involvement, or in-person meetings.

Documentation and Recordkeeping

All acknowledgments, receipts, and recognition actions are recorded in the CRM to maintain a complete donor history.

Review and Approval

Donor Recognition and Acknowledgement procedures are reviewed annually and updated as needed to ensure compliance and best practices.`,

  s8_stewardship: `Policy Statement

[Organization Name] is committed to building and sustaining long-term, meaningful relationships with donors. Donor cultivation and stewardship are core components of ethical and effective fund development and are essential to donor retention, trust, and mission sustainability.

Purpose

The purpose of donor cultivation and stewardship is to engage donors beyond the transaction of giving by demonstrating impact, transparency, appreciation, and partnership. Strong stewardship practices increase donor retention, encourage recurring and upgraded giving, and strengthen alignment between donor interests and organizational mission.

Definitions

Donor Cultivation: The intentional process of developing relationships with prospective and current donors through engagement, communication, and education about the organization’s mission and impact.

Donor Stewardship: The ongoing process of thanking donors, reporting on outcomes, maintaining transparency, and ensuring donors feel valued and connected to the organization.

Donor Retention: A measurement of the percentage of donors who continue to give year over year.

Upgrading: Efforts designed to encourage donors to increase their level of giving over time.

Communication Strategies: Planned, coordinated outreach efforts often using email, mail, events, and personal contact to engage donors throughout the year.

Roles and Responsibilities

All Board members and staff have a role in donor cultivation and stewardship. The Executive Director provides leadership in relationship-building with key donors. The Office Manager supports stewardship by ensuring timely acknowledgments and accurate donor records. Board members serve as ambassadors and may participate in donor outreach and appreciation activities.

Stewardship Philosophy and Benchmarks

[Organization Name] values donor retention and aims to exceed sector averages for donor retention. Nationally, average donor retention is approximately 45 percent; [Organization Name] strives to achieve retention rates of 60 percent or higher through intentional stewardship and consistent communication.

Donor Cultivation and Stewardship Procedures

Communication and Outreach

Donors receive regular communications that demonstrate organizational outcomes, financial transparency, and program impact. Communications may include e-newsletters, impact reports, annual reports, appeals, event invitations, and personal messages.

Staff meet annually to develop an organizational communication and office calendar for the upcoming fiscal year. The calendar includes at least six donor touchpoints per year, such as:
- Annual fundraising events
- Giving campaigns
- End-of-year appeals
- Tax season communications
- Annual reports
- Program impact updates

Personal Engagement

The Executive Director and designated staff cultivate relationships with donors through phone calls, meetings, and invitations to engage more deeply with the organization. When appropriate, donors may be invited to lunch, coffee, or events to strengthen relationships and better understand donor motivations.

Use of the CRM

All donor interactions, outreach efforts, and stewardship activities are documented in the CRM. Historical data is used to inform future communications, identify trends, and support relationship management.

Upgrading and Retention Strategies

Staff regularly review donor giving history to identify opportunities for renewal, increased giving, and deeper engagement. Stewardship efforts are tailored to donor interests and giving patterns.

Documentation and References

Organizational communication calendar

CRM stewardship reports

Review and Approval

Donor Cultivation and Stewardship policies and procedures are reviewed annually and updated as needed to reflect best practices and organizational priorities.`,

  s9_grants: `Policy Statement

[Organization Name] proactively seeks grant funding to support its mission and programs. Grants management practices are designed to ensure strategic alignment, timely submissions, accurate reporting, and strong funder relationships.

Purpose

The purpose of grants management is to identify, pursue, secure, and steward grant funding opportunities in a manner that is organized, compliant, and collaborative. Effective grants management ensures that awarded funds are used as intended and that reporting obligations are met.

Definitions

Grant Opportunity: A funding opportunity offered by a foundation, corporation, or government entity.

Grant Prospecting: The process of identifying potential grant funders aligned with organizational mission and programs.

Grant Award: A favorable decision resulting in financial support.

Grant Reporting: Required narrative and financial documentation submitted to funders following an award.

Performance Data: Quantitative and qualitative information demonstrating program outcomes and effectiveness.

Roles and Responsibilities

The Executive Director and Director of Operations have authority to submit grant requests and proposals. The Director of Operations assists in preparing and reviewing financial attachments and ensures accuracy and compliance. The Development Coordinator or Office Manager tracks grant opportunities, deadlines, and reporting requirements in the CRM. Board leadership may provide signatures or approvals when required by funders.

Grant Prospecting and Evaluation

Staff proactively seek funding opportunities through funder communications, grant databases, newsletters, and professional networks. Opportunities are evaluated for alignment with mission, organizational capacity, funding priorities, and reporting requirements. Organizational readiness, including compliance with IRS and state requirements is maintained to support timely submissions.

Grant Application Development

Once a grant opportunity is identified as a good fit, staff confirm whether a constituent record exists in the CRM. Opportunities are recorded with campaign name, amount requested, deadline, and likelihood of success. Tasks and deadlines are assigned to support effective project management.

Grant proposals include required narratives, budgets, outcomes, evaluation plans, and supporting documentation. Drafts are reviewed by the Executive Director at least one week prior to submission. Financial attachments are reviewed and approved by the Director of Operations.

Submission and Tracking

Grant submissions are documented in the CRM, including submission date and anticipated response date. Staff communicate internally upon submission and acknowledge collective effort.

Grant Awards and Implementation

Upon notification of a grant award, staff review award terms, prepare an implementation timeline, and schedule a kickoff meeting with all staff responsible for program delivery. Grant agreements and budgets are shared with relevant staff to ensure understanding of funder expectations.

Grant Reporting and Stewardship

Reporting responsibilities are clearly assigned. Report deadlines are entered into the CRM with reminders to ensure timely submission. Narrative and financial reports reflect actual program performance and use of funds. Staff maintain ongoing communication with funders to support long-term relationships.

Declinations and Feedback

When a grant request is declined, staff document the decision and any feedback received. Feedback is reviewed to strengthen future proposals and refine grant strategies.

Documentation and References

Grant opportunity checklist

CRM grant tracking reports

Grant agreements and reporting guidelines

Review and Approval

Grants Management policies and procedures are reviewed annually and updated as needed to reflect best practices and funder requirements.`,

  s10_awards_declines: `Policy Statement

[Organization Name] documents and responds to all funding announcements and declinations in a consistent, timely, and professional manner. Accurate tracking of funding outcomes supports stewardship, institutional learning, and long-term funder relationships.

Purpose

The purpose of these procedures is to ensure that grant awards and declinations are recorded accurately, communicated internally, and used to strengthen future fundraising efforts.

Definitions

Funding Announcement: Notification that a funding request has been approved and awarded.

Funding Declination: Notification that a funding request has not been approved.

Roles and Responsibilities

The Executive Director, Director of Operations, and Development or Office staff collaborate to manage announcements and declinations. Responsibilities include internal communication, CRM documentation, and next-step planning.

Funding Announcement Procedures

When [Organization Name] receives notice that funding has been awarded:

Notification is shared internally, typically via email, with relevant staff and leadership.

Significant awards may be acknowledged through in-person or team celebrations.

The Executive Director reviews award terms and determines immediate next steps.

If the Board Chair’s signature was required for submission, the Board Chair is informed of the award.

An implementation timeline is prepared.

A grant kickoff meeting is scheduled with staff responsible for program delivery.

Reporting responsibilities are assigned and deadlines entered into the CRM with reminders.

Funding Declination Procedures

When [Organization Name] receives notice that funding has been declined:

The decision is communicated internally to relevant staff.

Staff are encouraged to view declinations as learning opportunities.

The Executive Director or Development staff request feedback from the funder when possible.

Feedback is documented in the CRM and used to strengthen future proposals.

Documentation and Recordkeeping

All funding announcements, declinations, correspondence, and feedback are recorded in the CRM. Formal award or declination letters may be scanned and stored electronically.

Review and Approval

Funding Announcement and Declination procedures are reviewed annually and updated as needed.`,

  s11_sponsorships: `Policy Statement

[Organization Name] proactively seeks corporate sponsorships and business partnerships to support fundraising events and mission-aligned initiatives. Corporate sponsorship practices emphasize transparency, mutual benefit, and appropriate recognition.

Purpose

The purpose of corporate sponsorships is to engage businesses as partners through financial support, in-kind contributions, and shared community impact. Sponsorship opportunities are structured to clearly communicate benefits and expectations.

Definitions

Corporate Sponsorship: Financial or in-kind support provided by a business in exchange for recognition or marketing benefits.

Sponsorship Benefits: The recognition and visibility provided to sponsors, such as logos, event signage, or promotional acknowledgments.

Roles and Responsibilities

The Executive Director and Marketing and Communications Manager have authority to solicit corporate sponsorships. The Director of Operations assists with financial documentation as needed. Development or Office staff enter sponsorship opportunities into the CRM and track commitments.

Sponsorship Materials and Benefits

[Organization Name] develops high-quality sponsorship materials for fundraising events. Materials outline sponsorship levels, associated benefits, event details, and instructions for securing sponsorships. Sponsor benefits are conveyed in writing and approved internally prior to solicitation.

Sponsors may be recognized through event programs, signage, the organization’s website, and personalized thank-you communications.

Corporate Sponsorship Procedures

Staff maintain records of past and prospective sponsors for each event.

Sponsorship opportunities are entered into the CRM under the appropriate constituent record.

Staff collaborate to determine the most appropriate representative to approach each prospective sponsor.

Upon commitment, sponsorship details are documented and acknowledgment procedures are initiated.

Documentation and Recordkeeping

Sponsorship agreements, invoices, and recognition commitments are retained and recorded in the CRM.

Review and Approval

Corporate Sponsorship policies and procedures are reviewed annually and updated as needed.`,

  s12_events: `Policy Statement

[Organization Name] may conduct special events to raise funds, increase visibility, and engage the community in support of its mission. Special events are planned and executed in a manner that is financially responsible, mission-aligned, and compliant with applicable laws and policies.

Purpose

The purpose of special events fundraising is to generate net revenue, strengthen donor and community relationships, and create opportunities for stewardship and engagement. Events are evaluated to ensure that costs, staff time, and risk are appropriate relative to anticipated benefits.

Definitions

Special Event: A fundraising activity such as a gala, tournament, auction, or campaign event designed to generate revenue and donor engagement.

Community-Hosted Event: A fundraising activity organized by a third party on behalf of [Organization Name].

Sponsorship: Financial or in-kind support provided in connection with an event in exchange for recognition.

Roles and Responsibilities

The Executive Director provides oversight for special events fundraising. Development, marketing, and operations staff coordinate event planning, sponsorship solicitation, financial tracking, and donor recognition. Board members may assist with sponsorship outreach and event participation.

Special Events Procedures

Events are evaluated in advance for mission alignment, financial feasibility, staffing capacity, and risk.

Event budgets are developed and approved prior to execution and include anticipated revenue, expenses, and sponsorship income.

Fundraising expenses and net revenue are tracked and documented.

Sponsorship benefits and recognition are communicated in writing.

Donor and sponsor acknowledgments follow donor recognition policies.

Community-Hosted Events

When third parties host fundraising events on behalf of [Organization Name], a Community-Hosted Event Agreement is required. The agreement outlines expectations related to branding, financial handling, liability, and use of the organization’s name.

Risk Management and Compliance

Appropriate insurance, permits, and licenses are obtained as required. Events involving raffles, bingo, or gaming activities comply with applicable state laws and licensing requirements.

Documentation and Recordkeeping

Event budgets, sponsorship agreements, financial summaries, and donor records are retained and recorded in the CRM.

Review and Approval

Special Events Fundraising policies and procedures are reviewed annually and updated as needed.`,

  s13_inkind: `Policy Statement

[Organization Name] accepts in-kind donations that support its mission and operational needs. In-kind gifts are managed with transparency, consistency, and compliance with IRS guidelines.

Purpose

The purpose of in-kind donation policies is to ensure that non-cash contributions are accepted, documented, acknowledged, and used appropriately without creating undue administrative or financial burden.

Definitions

In-Kind Donation: A non-cash contribution of goods or services.

Fair Market Value: The price an item would sell for on the open market; valuation is the donor’s responsibility.

Roles and Responsibilities

Staff members evaluate proposed in-kind donations for mission alignment and usefulness. The Executive Director or designated staff approve acceptance of in-kind gifts. Development or Office staff document and acknowledge in-kind contributions.

In-Kind Donation Guidelines

In-kind donations are accepted when they meet organizational needs and do not create excessive storage, maintenance, or disposal costs.

Donors are responsible for determining the fair market value of donated items.

[Organization Name] does not assign monetary value to in-kind gifts in acknowledgment letters.

Certain in-kind gifts may require an in-kind gift acceptance agreement.

Acknowledgment and Documentation

Donors receive written acknowledgment describing the donated item or service without assigning a value. All in-kind donations are recorded in the CRM.

Special Considerations

In-kind donations may be used directly, sold, or otherwise disposed of in a manner consistent with organizational needs and policies.

Review and Approval

In-Kind Donation policies and procedures are reviewed annually and updated as needed.`,

  s14_planned_giving: `Policy Statement

[Organization Name] encourages and responsibly stewards legacy and planned gifts to support long-term mission sustainability. Legacy giving practices honor donor intent, comply with legal and ethical standards, and emphasize thoughtful relationship management with donors and their families.

Purpose

The purpose of legacy and planned giving policies is to provide a clear framework for accepting, documenting, and stewarding future gifts while maintaining strong relationships with donors who wish to create a lasting impact.

Definitions

Legacy Gift / Planned Gift: A future gift designated through a will, trust, beneficiary designation, or other estate planning vehicle.

Binding Pledge: A legally enforceable commitment to make a gift.

Non-Binding Pledge: A statement of donor intent that is not legally enforceable.

Conditional Pledge: A pledge dependent on specific conditions being met.

Unconditional Pledge: A pledge made without conditions or contingencies.

Roles and Responsibilities

The Executive Director and designated development staff lead legacy gift cultivation and stewardship. The Office Manager supports documentation and CRM recordkeeping. Legal counsel may be consulted for complex or binding gift arrangements.

Legacy Gift Stewardship Philosophy

Legacy gifts often involve long time horizons and sensitive personal considerations. [Organization Name] approaches these relationships with care, transparency, and respect. Donors are encouraged to share their intentions with family members or estate executors to help ensure fulfillment of their wishes.

Legacy Gift Procedures

When a donor expresses interest in legacy giving, a designated staff member is assigned as the primary relationship manager in the CRM.

Donors receive ongoing communications, including impact updates and event invitations.

Relationship managers conduct periodic check-ins to maintain engagement and understanding.

Legacy gift intentions and documentation are recorded in the CRM.

Binding pledges are reviewed in consultation with legal counsel as appropriate.

Documentation and Recordkeeping

Legacy gift documentation, correspondence, and notes are retained securely. Pledge status and relevant timelines are tracked in the CRM.

Review and Approval

Legacy and Planned Giving policies and procedures are reviewed annually and updated as needed.`,

  s15_financial: `Policy Statement

[Organization Name] maintains sound financial management practices to ensure transparency, accountability, and stewardship of donor funds. Financial reporting supports informed decision-making by leadership, the Board of Directors, donors, and funders.

Purpose

The purpose of financial management and reporting policies is to ensure accurate tracking of revenue and expenses, proper handling of restricted funds, and compliance with accounting standards and regulatory requirements.

Definitions

Restricted Funds: Donations designated by donors for specific purposes.

Unrestricted Funds: Donations available for general operating use.

Fundraising Expenses: Costs incurred to solicit and steward contributions.

GAAP: Generally Accepted Accounting Principles governing financial reporting.

Roles and Responsibilities

The Board of Directors approves the annual budget prior to the start of the fiscal year. The Executive Director oversees financial operations. The Director of Operations or Finance staff manage day-to-day financial reporting, tracking, and compliance.

Budgeting and Financial Oversight

Annual budgets include anticipated revenue, program expenses, administrative costs, and fundraising expenses. Budgets are reviewed and approved by the Board and monitored regularly.

Restricted Funds Management

Restricted donations are tracked separately to ensure funds are used in accordance with donor intent. Systems and procedures are in place to prevent commingling of restricted and unrestricted funds.

Financial Reporting

Financial reports, including income and expense statements, are prepared regularly and reviewed by leadership. Reports may be generated monthly or quarterly to support oversight and planning.

Fundraising Expense Tracking

Fundraising expenses are tracked to allow reporting of the percentage of total expenses dedicated to fundraising activities. This information supports transparency and internal evaluation.

Grants Financial Management

Grant agreements and budgets are retained, and grant-related expenses are tracked to ensure compliance with funder requirements.

Review and Approval

Financial Management and Reporting policies and procedures are reviewed annually and updated as needed.`,

  s16_compliance: `Policy Statement

[Organization Name] is committed to full legal, ethical, and regulatory compliance in all fund development and organizational operations. Strong governance and accountability practices protect the organization, its donors, and the communities it serves.

Purpose

The purpose of this section is to outline compliance obligations, governance responsibilities, and accountability standards that support transparency, legal compliance, and public trust.

IRS Compliance and Public Disclosure

[Organization Name] complies with all applicable IRS reporting requirements for tax-exempt organizations. The organization files the appropriate annual information return (Form 990, 990-EZ, 990-N, or 990-PF, as applicable) by the required deadline. The Board of Directors or Executive Committee reviews the Form 990 prior to submission.

In accordance with federal law, [Organization Name] makes its IRS Form 990 available for public inspection, including the three most recent filings. Copies are provided upon request or made available through publicly accessible online sources.

State Registration and Charitable Solicitation

[Organization Name] maintains active registration and good standing with the Secretary of State in its home state. The organization complies with state charitable solicitation laws and registers to fundraise as required in jurisdictions where solicitations occur. Registration status is reviewed periodically to ensure ongoing compliance.

Donor Privacy and Data Protection

[Organization Name] protects donor and constituent information in accordance with applicable consumer data privacy laws. Donor data is collected, stored, and used only for legitimate organizational purposes. Donors may request access to, correction of, or deletion of their personal data and may opt out of communications at any time.

Conflict of Interest

Board members, officers, staff, and volunteers adhere to a Conflict of Interest Policy designed to prevent personal or financial interests from influencing organizational decisions. Conflicts are disclosed promptly and managed in accordance with policy.

Board Governance and Oversight

The Board of Directors provides fiduciary oversight and approves key policies, including this handbook. The Board approves the annual budget, ensures appropriate financial controls are in place, and supports ethical fundraising practices. Board members are expected to act as ambassadors for the organization and to make meaningful financial contributions annually.

Professional Fundraisers and Third Parties

When professional fundraisers or third-party fundraising partners are engaged, [Organization Name] ensures appropriate registration, oversight, and contractual agreements are in place as required by law.

Review and Approval

Compliance, Governance, and Accountability policies are reviewed annually and updated as necessary to reflect changes in law, regulation, and best practices.`,

  s17_appendices: `Attachments include sample receipts, gift acceptance agreements, community-hosted event agreements, donor privacy policy, and related forms.`,
};

