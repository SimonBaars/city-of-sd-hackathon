export interface TreeNode {
  name: string;
  value: number;
  fund_type?: string;
  children?: TreeNode[];
}

export interface CouncilItem {
  meetingId: string;
  meetingDate: string;
  itemId: string;
  title: string;
  vote: string;
  resolution: string;
  relatedDepts: string[];
  subcategory: string;
}
